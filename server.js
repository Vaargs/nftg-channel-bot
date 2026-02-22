// server.js - Backend API для статистики каналов
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
// Railway использует специальные переменные
const pool = process.env.DATABASE_URL 
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: false // Railway не требует SSL для internal connections
    })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'nftg_zonix',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD
    });

console.log('🔌 Подключение к PostgreSQL...');
console.log('   DATABASE_URL:', process.env.DATABASE_URL ? 'найден (Railway)' : 'не найден (локально)');

// Проверка подключения к БД
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err);
        process.exit(1);
    }
    console.log('✅ Подключено к PostgreSQL');
    release();
});

// ==================== MIDDLEWARE ====================

// Проверка API ключа
function authenticateBot(req, res, next) {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey || apiKey !== process.env.BOT_API_KEY) {
        return res.status(401).json({ 
            error: 'Unauthorized',
            message: 'Invalid API key'
        });
    }
    
    next();
}

// ==================== API ENDPOINTS ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        service: 'NFTG-ZONIX Channel Statistics API',
        version: '2.0.0',
        endpoints: {
            'POST /api/channels/update-stats': 'Update channel statistics (Bot only)',
            'GET /api/channels': 'Get channels list',
            'GET /api/channels/:channelId': 'Get specific channel',
            'DELETE /api/channels/:channelId': 'Remove channel (Bot only)',
            'POST /api/reviews': 'Add/update review',
            'GET /api/channels/:channelId/reviews': 'Get channel reviews',
            'GET /api/categories': 'Get available categories'
        }
    });
});

// Получить список категорий
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM categories ORDER BY name'
        );
        
        res.json({
            success: true,
            categories: result.rows
        });
    } catch (error) {
        console.error('❌ Ошибка получения категорий:', error);
        res.status(500).json({ error: error.message });
    }
});

// Обновление статистики канала
app.post('/api/channels/update-stats', authenticateBot, async (req, res) => {
    const {
        channelId,
        title,
        username,
        description,
        subscribersCount,
        photoUrl,
        type,
        botIsAdmin
    } = req.body;
    
    // Валидация
    if (!channelId || !title) {
        return res.status(400).json({ 
            error: 'Bad Request',
            message: 'channelId and title are required'
        });
    }
    
    try {
        // Проверяем существует ли канал
        const existing = await pool.query(
            'SELECT id FROM channels WHERE channel_id = $1',
            [channelId]
        );
        
        if (existing.rows.length > 0) {
            // Обновляем существующий
            const result = await pool.query(`
                UPDATE channels 
                SET 
                    title = $1,
                    username = $2,
                    description = $3,
                    subscribers_count = $4,
                    photo_url = $5,
                    channel_type = $6,
                    bot_is_admin = $7,
                    last_update = NOW()
                WHERE channel_id = $8
                RETURNING *
            `, [title, username, description, subscribersCount, photoUrl, type, botIsAdmin, channelId]);
            
            console.log(`✅ Канал обновлён: ${title} (${subscribersCount} подписчиков)`);
            
            res.json({ 
                success: true, 
                action: 'updated',
                channel: result.rows[0]
            });
            
        } else {
            // Создаём новую запись
            const result = await pool.query(`
                INSERT INTO channels 
                (channel_id, title, username, description, subscribers_count, photo_url, channel_type, bot_is_admin)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
            `, [channelId, title, username, description, subscribersCount, photoUrl, type, botIsAdmin]);
            
            console.log(`✅ Канал создан: ${title} (${subscribersCount} подписчиков)`);
            
            res.json({ 
                success: true, 
                action: 'created',
                channel: result.rows[0]
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка обновления канала:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Получение списка каналов с фильтрами
app.get('/api/channels', async (req, res) => {
    const { 
        minSubscribers, 
        maxSubscribers, 
        category, 
        search,
        sortBy = 'subscribers_count',
        order = 'DESC',
        limit = 50,
        offset = 0
    } = req.query;
    
    try {
        let query = 'SELECT * FROM channels WHERE bot_is_admin = true';
        const params = [];
        let paramIndex = 1;
        
        // Фильтр по минимальному количеству подписчиков
        if (minSubscribers) {
            query += ` AND subscribers_count >= $${paramIndex}`;
            params.push(parseInt(minSubscribers));
            paramIndex++;
        }
        
        // Фильтр по максимальному количеству подписчиков
        if (maxSubscribers) {
            query += ` AND subscribers_count <= $${paramIndex}`;
            params.push(parseInt(maxSubscribers));
            paramIndex++;
        }
        
        // Фильтр по категории
        if (category && category !== 'all') {
            query += ` AND category = $${paramIndex}`;
            params.push(category);
            paramIndex++;
        }
        
        // Поиск по названию или описанию
        if (search) {
            query += ` AND (title ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR username ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        // Подсчёт общего количества
        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);
        
        // Сортировка
        const allowedSortFields = ['subscribers_count', 'title', 'last_update', 'created_at'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'subscribers_count';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        query += ` ORDER BY ${sortField} ${sortOrder}`;
        
        // Pagination
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            channels: result.rows,
            total: total,
            page: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(total / limit),
            limit: parseInt(limit)
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения каналов:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Получение конкретного канала
app.get('/api/channels/:channelId', async (req, res) => {
    const { channelId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT * FROM channels WHERE channel_id = $1',
            [channelId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Not Found',
                message: 'Channel not found'
            });
        }
        
        res.json({
            success: true,
            channel: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения канала:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Удаление канала
app.delete('/api/channels/:channelId', authenticateBot, async (req, res) => {
    const { channelId } = req.params;
    
    try {
        const result = await pool.query(
            'DELETE FROM channels WHERE channel_id = $1 RETURNING *',
            [channelId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Not Found',
                message: 'Channel not found'
            });
        }
        
        console.log(`✅ Канал удалён: ${result.rows[0].title}`);
        
        res.json({ 
            success: true,
            message: 'Channel removed',
            channel: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления канала:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Статистика API
app.get('/api/stats', async (req, res) => {
    try {
        const totalChannels = await pool.query('SELECT COUNT(*) FROM channels');
        const activeChannels = await pool.query('SELECT COUNT(*) FROM channels WHERE bot_is_admin = true');
        const totalSubscribers = await pool.query('SELECT SUM(subscribers_count) FROM channels WHERE bot_is_admin = true');
        const lastUpdate = await pool.query('SELECT MAX(last_update) FROM channels');
        
        res.json({
            success: true,
            stats: {
                totalChannels: parseInt(totalChannels.rows[0].count),
                activeChannels: parseInt(activeChannels.rows[0].count),
                totalSubscribers: parseInt(totalSubscribers.rows[0].sum || 0),
                lastUpdate: lastUpdate.rows[0].max
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// ==================== REVIEWS ENDPOINTS ====================

// Добавить/обновить отзыв
app.post('/api/reviews', async (req, res) => {
    const {
        channel_id,
        user_telegram_id,
        user_username,
        user_first_name,
        rating,
        comment
    } = req.body;
    
    // Валидация
    if (!channel_id || !user_telegram_id || !rating) {
        return res.status(400).json({ 
            error: 'Bad Request',
            message: 'channel_id, user_telegram_id и rating обязательны'
        });
    }
    
    if (rating < 1 || rating > 5) {
        return res.status(400).json({ 
            error: 'Bad Request',
            message: 'rating должен быть от 1 до 5'
        });
    }
    
    try {
        // Проверяем существует ли канал
        const channelExists = await pool.query(
            'SELECT channel_id FROM channels WHERE channel_id = $1',
            [channel_id]
        );
        
        if (channelExists.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Канал не найден'
            });
        }
        
        // Проверяем не оставлял ли пользователь уже отзыв
        const existing = await pool.query(
            'SELECT id FROM reviews WHERE channel_id = $1 AND user_telegram_id = $2',
            [channel_id, user_telegram_id]
        );
        
        if (existing.rows.length > 0) {
            // Обновляем существующий отзыв
            const result = await pool.query(
                `UPDATE reviews 
                 SET rating = $1, comment = $2, user_username = $3, user_first_name = $4, updated_at = NOW()
                 WHERE channel_id = $5 AND user_telegram_id = $6
                 RETURNING *`,
                [rating, comment, user_username, user_first_name, channel_id, user_telegram_id]
            );
            
            console.log(`✅ Отзыв обновлён: канал ${channel_id}, рейтинг ${rating}`);
            
            res.json({
                success: true,
                action: 'updated',
                review: result.rows[0]
            });
        } else {
            // Создаём новый отзыв
            const result = await pool.query(
                `INSERT INTO reviews 
                 (channel_id, user_telegram_id, user_username, user_first_name, rating, comment)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [channel_id, user_telegram_id, user_username, user_first_name, rating, comment]
            );
            
            console.log(`✅ Отзыв добавлен: канал ${channel_id}, рейтинг ${rating}`);
            
            res.json({
                success: true,
                action: 'created',
                review: result.rows[0]
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка добавления отзыва:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Получить отзывы канала
app.get('/api/channels/:channelId/reviews', async (req, res) => {
    const { channelId } = req.params;
    const { limit = 50, offset = 0, sortBy = 'created_at', order = 'DESC' } = req.query;
    
    try {
        const allowedSortFields = ['created_at', 'rating', 'updated_at'];
        const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        
        const query = `
            SELECT * FROM reviews 
            WHERE channel_id = $1 
            ORDER BY ${sortField} ${sortOrder}
            LIMIT $2 OFFSET $3
        `;
        
        const result = await pool.query(query, [channelId, parseInt(limit), parseInt(offset)]);
        
        // Получаем общее количество
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM reviews WHERE channel_id = $1',
            [channelId]
        );
        
        res.json({
            success: true,
            reviews: result.rows,
            total: parseInt(countResult.rows[0].count)
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения отзывов:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Получить статистику отзывов канала
app.get('/api/channels/:channelId/reviews/stats', async (req, res) => {
    const { channelId } = req.params;
    
    try {
        const stats = await pool.query(
            `SELECT 
                COUNT(*) as total_reviews,
                AVG(rating)::DECIMAL(3,2) as avg_rating,
                COUNT(CASE WHEN rating = 5 THEN 1 END) as five_stars,
                COUNT(CASE WHEN rating = 4 THEN 1 END) as four_stars,
                COUNT(CASE WHEN rating = 3 THEN 1 END) as three_stars,
                COUNT(CASE WHEN rating = 2 THEN 1 END) as two_stars,
                COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
             FROM reviews 
             WHERE channel_id = $1`,
            [channelId]
        );
        
        res.json({
            success: true,
            stats: stats.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики отзывов:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Удалить отзыв (только сам пользователь)
app.delete('/api/reviews/:reviewId', async (req, res) => {
    const { reviewId } = req.params;
    const { user_telegram_id } = req.body;
    
    if (!user_telegram_id) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'user_telegram_id обязателен'
        });
    }
    
    try {
        const result = await pool.query(
            'DELETE FROM reviews WHERE id = $1 AND user_telegram_id = $2 RETURNING *',
            [reviewId, user_telegram_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Отзыв не найден или вы не автор'
            });
        }
        
        console.log(`✅ Отзыв удалён: ${reviewId}`);
        
        res.json({
            success: true,
            message: 'Отзыв удалён',
            review: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления отзыва:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});
// ==================== ДОПОЛНИТЕЛЬНЫЕ ENDPOINTS ДЛЯ БОТА ====================
// Добавь эти endpoints в твой server.js ПЕРЕД инициализацией БД

// Получить каналы пользователя (для загрузки при старте бота)
app.get('/api/channels/user/:userId', authenticateBot, async (req, res) => {
    const { userId } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT * FROM channels WHERE owner_telegram_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        
        res.json({
            success: true,
            channels: result.rows
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения каналов пользователя:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Получить все каналы (для загрузки при старте бота)
app.get('/api/channels/all', authenticateBot, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM channels ORDER BY created_at DESC'
        );
        
        res.json({
            success: true,
            channels: result.rows
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения всех каналов:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});

// Сохранить канал (без публикации)
app.post('/api/channels/save', authenticateBot, async (req, res) => {
    const {
        channel_id,
        title,
        username,
        subscribers_count,
        photo_url,
        owner_telegram_id,
        is_published
    } = req.body;
    
    try {
        // Проверяем существует ли канал
        const existing = await pool.query(
            'SELECT * FROM channels WHERE channel_id = $1',
            [channel_id]
        );
        
        if (existing.rows.length > 0) {
            // Обновляем существующий
            const result = await pool.query(
                `UPDATE channels 
                 SET title = $1, username = $2, subscribers_count = $3, 
                     photo_url = $4, last_update = NOW()
                 WHERE channel_id = $5
                 RETURNING *`,
                [title, username, subscribers_count, photo_url, channel_id]
            );
            
            res.json({
                success: true,
                action: 'updated',
                channel: result.rows[0]
            });
        } else {
            // Создаём новый
            const result = await pool.query(
                `INSERT INTO channels 
                 (channel_id, title, username, subscribers_count, photo_url, 
                  owner_telegram_id, is_published, bot_is_admin)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                 RETURNING *`,
                [channel_id, title, username, subscribers_count, photo_url, 
                 owner_telegram_id, is_published || false]
            );
            
            res.json({
                success: true,
                action: 'created',
                channel: result.rows[0]
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения канала:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: error.message 
        });
    }
});
// ==================== ИНИЦИАЛИЗАЦИЯ БД ====================

async function initDatabase() {
    const createTablesQuery = `
        -- Таблица каналов
        CREATE TABLE IF NOT EXISTS channels (
            id SERIAL PRIMARY KEY,
            channel_id BIGINT UNIQUE NOT NULL,
            title VARCHAR(255) NOT NULL,
            username VARCHAR(255),
            description TEXT,
            subscribers_count INTEGER DEFAULT 0,
            photo_url TEXT,
            channel_type VARCHAR(50),
            bot_is_admin BOOLEAN DEFAULT false,
            
            -- Категории
            category_1 VARCHAR(100),
            category_2 VARCHAR(100),
            category_3 VARCHAR(100),
            
            -- Теги (массивы)
            thematic_tags TEXT[],
            format_tags TEXT[],
            
            -- Владелец
            owner_telegram_id BIGINT,
            owner_username VARCHAR(255),
            
            -- Рейтинги (вычисляются автоматически из reviews)
            rating_average DECIMAL(3,2) DEFAULT 0.00,
            rating_count INTEGER DEFAULT 0,
            reviews_count INTEGER DEFAULT 0,
            
            -- Статус
            is_published BOOLEAN DEFAULT false,
            is_verified BOOLEAN DEFAULT false,
            
            -- Связь с пикселем (опционально)
            pixel_id INTEGER,
            
            last_update TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW(),
            published_at TIMESTAMP
        );
        
        -- Таблица отзывов
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            channel_id BIGINT NOT NULL,
            user_telegram_id BIGINT NOT NULL,
            user_username VARCHAR(255),
            user_first_name VARCHAR(255),
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(channel_id, user_telegram_id)
        );
        
        -- Таблица категорий
        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            emoji VARCHAR(10),
            description TEXT,
            channels_count INTEGER DEFAULT 0
        );
        
        -- Индексы для channels
        CREATE INDEX IF NOT EXISTS idx_subscribers ON channels(subscribers_count);
        CREATE INDEX IF NOT EXISTS idx_username ON channels(username);
        CREATE INDEX IF NOT EXISTS idx_category_1 ON channels(category_1);
        CREATE INDEX IF NOT EXISTS idx_category_2 ON channels(category_2);
        CREATE INDEX IF NOT EXISTS idx_category_3 ON channels(category_3);
        CREATE INDEX IF NOT EXISTS idx_last_update ON channels(last_update);
        CREATE INDEX IF NOT EXISTS idx_published ON channels(is_published);
        CREATE INDEX IF NOT EXISTS idx_rating ON channels(rating_average);
        
        -- Индексы для reviews
        CREATE INDEX IF NOT EXISTS idx_review_channel ON reviews(channel_id);
        CREATE INDEX IF NOT EXISTS idx_review_user ON reviews(user_telegram_id);
        CREATE INDEX IF NOT EXISTS idx_review_rating ON reviews(rating);
        CREATE INDEX IF NOT EXISTS idx_review_created ON reviews(created_at);
        
        -- Триггер для автоматического пересчёта рейтинга
        CREATE OR REPLACE FUNCTION update_channel_rating()
        RETURNS TRIGGER AS $$
        BEGIN
            UPDATE channels
            SET 
                rating_average = (
                    SELECT COALESCE(AVG(rating), 0)::DECIMAL(3,2)
                    FROM reviews
                    WHERE channel_id = COALESCE(NEW.channel_id, OLD.channel_id)
                ),
                rating_count = (
                    SELECT COUNT(*)
                    FROM reviews
                    WHERE channel_id = COALESCE(NEW.channel_id, OLD.channel_id)
                ),
                reviews_count = (
                    SELECT COUNT(*)
                    FROM reviews
                    WHERE channel_id = COALESCE(NEW.channel_id, OLD.channel_id)
                        AND comment IS NOT NULL AND comment != ''
                )
            WHERE channel_id = COALESCE(NEW.channel_id, OLD.channel_id);
            
            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;
        
        DROP TRIGGER IF EXISTS update_rating_after_review ON reviews;
        CREATE TRIGGER update_rating_after_review
        AFTER INSERT OR UPDATE OR DELETE ON reviews
        FOR EACH ROW EXECUTE FUNCTION update_channel_rating();
        
        -- Предзаполненные категории
        INSERT INTO categories (name, emoji, description) VALUES
        ('Технологии', '💻', 'IT, гаджеты, программирование'),
        ('Новости', '📰', 'Новостные каналы'),
        ('Бизнес', '💼', 'Предпринимательство, финансы'),
        ('Криптовалюты', '₿', 'Крипто, блокчейн, NFT'),
        ('Образование', '📚', 'Обучение, курсы'),
        ('Развлечения', '🎬', 'Кино, сериалы, юмор'),
        ('Спорт', '⚽', 'Спортивные новости'),
        ('Музыка', '🎵', 'Музыкальные каналы'),
        ('Игры', '🎮', 'Игровые каналы'),
        ('Мода', '👗', 'Стиль, красота'),
        ('Путешествия', '✈️', 'Туризм'),
        ('Еда', '🍕', 'Кулинария, рецепты'),
        ('Здоровье', '💪', 'ЗОЖ, фитнес'),
        ('Наука', '🔬', 'Научные статьи'),
        ('Искусство', '🎨', 'Художники, дизайн'),
        ('Авто', '🚗', 'Автомобили'),
        ('Недвижимость', '🏠', 'Покупка, аренда'),
        ('Маркетинг', '📊', 'Реклама, SMM'),
        ('Фото', '📷', 'Фотография'),
        ('Саморазвитие', '🌱', 'Личностный рост')
        ON CONFLICT (name) DO NOTHING;
    `;
    
    try {
        await pool.query(createTablesQuery);
        console.log('✅ Таблицы созданы/проверены');
        console.log('✅ Триггер для рейтингов создан');
        console.log('✅ Категории загружены');
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error);
        throw error;
    }
}

// ==================== ЗАПУСК СЕРВЕРА ====================

async function startServer() {
    try {
        // Инициализация БД
        await initDatabase();
        
        // Запуск сервера
        app.listen(PORT, () => {
            console.log(`\n🚀 Server running on port ${PORT}`);
            console.log(`   URL: http://localhost:${PORT}`);
            console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`   Database: ${process.env.DB_NAME}`);
            console.log('\n✅ Ready to accept requests\n');
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\n👋 Получен сигнал SIGTERM, останавливаем сервер...');
    await pool.end();
    process.exit(0);
});
