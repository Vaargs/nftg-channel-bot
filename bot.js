// bot.js - Объединённый файл: API + Бот
require('dotenv').config();

// ==================== API СЕРВЕР ====================
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const apiApp = express();
const API_PORT = process.env.PORT || 3000;

// Middleware
apiApp.use(cors({
    origin: function(origin, callback) {
        // Разрешаем запросы без origin (мобильные приложения, Postman)
        if (!origin) return callback(null, true);
        
        const allowedPatterns = [
            /\.vercel\.app$/,
            /\.railway\.app$/,
            /localhost/,
            /127\.0\.0\.1/,
            /telegram\.org$/,
            /web\.telegram\.org$/
        ];
        
        const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.log('⚠️ CORS blocked origin:', origin);
            callback(null, true); // Пока разрешаем всё для MVP
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Preflight для всех роутов
apiApp.options('*', cors());

apiApp.use(express.json());

// PostgreSQL подключение
const pool = process.env.DATABASE_URL 
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: false
    })
    : new Pool({
        host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
        port: process.env.PGPORT || process.env.DB_PORT || 5432,
        database: process.env.PGDATABASE || process.env.DB_NAME || 'nftg_zonix',
        user: process.env.PGUSER || process.env.DB_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || process.env.DB_PASSWORD
    });

console.log('🔌 Подключение к PostgreSQL...');

pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Ошибка подключения к БД:', err);
    } else {
        console.log('✅ Подключено к PostgreSQL');
        release();
    }
});

// Middleware для проверки API ключа
function authenticateBot(req, res, next) {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    if (!apiKey || apiKey !== process.env.BOT_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// API Endpoints
apiApp.get('/', (req, res) => {
    res.json({
        service: 'NFTG-ZONIX API + Bot',
        version: '2.0.0',
        status: 'running'
    });
});

apiApp.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY name');
        res.json({ success: true, categories: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.get('/api/channels', async (req, res) => {
    const { published } = req.query;
    try {
        let query = 'SELECT * FROM channels WHERE 1=1';
        const params = [];
        
        if (published === 'true') {
            query += ' AND is_published = true';
        }
        
        query += ' ORDER BY subscribers_count DESC LIMIT 50';
        
        const result = await pool.query(query, params);
        res.json({ success: true, channels: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.post('/api/channels/update-stats', authenticateBot, async (req, res) => {
    const data = req.body;
    
    try {
        const existing = await pool.query('SELECT * FROM channels WHERE channel_id = $1', [data.channel_id]);
        
        if (existing.rows.length > 0) {
            const result = await pool.query(
                `UPDATE channels SET title = $1, username = $2, description = $3, 
                 subscribers_count = $4, photo_url = $5, category_1 = $6, 
                 thematic_tags = $7, format_tags = $8, is_published = $9, 
                 last_update = NOW() WHERE channel_id = $10 RETURNING *`,
                [data.title, data.username, data.description, data.subscribers_count, 
                 data.photo_url, data.category_1, data.thematic_tags, data.format_tags, 
                 data.is_published, data.channel_id]
            );
            res.json({ success: true, action: 'updated', channel: result.rows[0] });
        } else {
            const result = await pool.query(
                `INSERT INTO channels (channel_id, title, username, description, subscribers_count, 
                 photo_url, category_1, thematic_tags, format_tags, owner_telegram_id, 
                 owner_username, is_published, bot_is_admin) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true) RETURNING *`,
                [data.channel_id, data.title, data.username, data.description, 
                 data.subscribers_count, data.photo_url, data.category_1, data.thematic_tags, 
                 data.format_tags, data.owner_telegram_id, data.owner_username, data.is_published]
            );
            res.json({ success: true, action: 'created', channel: result.rows[0] });
        }
    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ error: error.message });
    }
});

apiApp.get('/api/channels/user/:userId', authenticateBot, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM channels WHERE owner_telegram_id = $1 ORDER BY created_at DESC',
            [req.params.userId]
        );
        res.json({ success: true, channels: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.get('/api/channels/all', authenticateBot, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM channels ORDER BY created_at DESC');
        res.json({ success: true, channels: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.post('/api/channels/save', authenticateBot, async (req, res) => {
    const { channel_id, title, username, subscribers_count, photo_url, owner_telegram_id, is_published } = req.body;
    
    try {
        const existing = await pool.query('SELECT * FROM channels WHERE channel_id = $1', [channel_id]);
        
        if (existing.rows.length > 0) {
            const result = await pool.query(
                `UPDATE channels SET title = $1, username = $2, subscribers_count = $3, 
                 photo_url = $4, last_update = NOW() WHERE channel_id = $5 RETURNING *`,
                [title, username, subscribers_count, photo_url, channel_id]
            );
            res.json({ success: true, action: 'updated', channel: result.rows[0] });
        } else {
            const result = await pool.query(
                `INSERT INTO channels (channel_id, title, username, subscribers_count, photo_url, 
                 owner_telegram_id, is_published, bot_is_admin) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
                [channel_id, title, username, subscribers_count, photo_url, owner_telegram_id, is_published || false]
            );
            res.json({ success: true, action: 'created', channel: result.rows[0] });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.delete('/api/channels/:channelId', authenticateBot, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM channels WHERE channel_id = $1 RETURNING *',
            [req.params.channelId]
        );
        res.json({ success: true, message: 'Channel removed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.post('/api/reviews', async (req, res) => {
    const { channel_id, user_telegram_id, user_username, user_first_name, rating, comment } = req.body;
    
    if (!channel_id || !user_telegram_id || !rating) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        const existing = await pool.query(
            'SELECT id FROM reviews WHERE channel_id = $1 AND user_telegram_id = $2',
            [channel_id, user_telegram_id]
        );
        
        if (existing.rows.length > 0) {
            const result = await pool.query(
                `UPDATE reviews SET rating = $1, comment = $2, updated_at = NOW() 
                 WHERE channel_id = $3 AND user_telegram_id = $4 RETURNING *`,
                [rating, comment, channel_id, user_telegram_id]
            );
            res.json({ success: true, action: 'updated', review: result.rows[0] });
        } else {
            const result = await pool.query(
                `INSERT INTO reviews (channel_id, user_telegram_id, user_username, user_first_name, rating, comment) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [channel_id, user_telegram_id, user_username, user_first_name, rating, comment]
            );
            res.json({ success: true, action: 'created', review: result.rows[0] });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Инициализация БД
async function initDatabase() {
    const sql = `
        CREATE TABLE IF NOT EXISTS channels (
            id SERIAL PRIMARY KEY,
            channel_id BIGINT UNIQUE NOT NULL,
            title VARCHAR(255) NOT NULL,
            username VARCHAR(255),
            description TEXT,
            subscribers_count INTEGER DEFAULT 0,
            photo_url TEXT,
            category_1 VARCHAR(100),
            thematic_tags TEXT[],
            format_tags TEXT[],
            owner_telegram_id BIGINT,
            owner_username VARCHAR(255),
            rating_average DECIMAL(3,2) DEFAULT 0,
            reviews_count INTEGER DEFAULT 0,
            is_published BOOLEAN DEFAULT false,
            is_verified BOOLEAN DEFAULT false,
            bot_is_admin BOOLEAN DEFAULT false,
            last_update TIMESTAMP DEFAULT NOW(),
            created_at TIMESTAMP DEFAULT NOW()
        );
        
        -- Добавляем колонки если их нет (для существующих таблиц)
        DO $$ 
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                          WHERE table_name='channels' AND column_name='thematic_tags') THEN
                ALTER TABLE channels ADD COLUMN thematic_tags TEXT[];
            END IF;
            
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                          WHERE table_name='channels' AND column_name='format_tags') THEN
                ALTER TABLE channels ADD COLUMN format_tags TEXT[];
            END IF;
        END $$;
        
        CREATE TABLE IF NOT EXISTS reviews (
            id SERIAL PRIMARY KEY,
            channel_id BIGINT NOT NULL,
            user_telegram_id BIGINT NOT NULL,
            user_username VARCHAR(255),
            user_first_name VARCHAR(255),
            rating INTEGER CHECK (rating >= 1 AND rating <= 5),
            comment TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(channel_id, user_telegram_id)
        );
        
        CREATE TABLE IF NOT EXISTS categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            emoji VARCHAR(10)
        );
        
        INSERT INTO categories (name, emoji) VALUES
        ('Технологии', '💻'), ('Новости', '📰'), ('Бизнес', '💼'),
        ('Криптовалюты', '₿'), ('Образование', '📚'), ('Развлечения', '🎬'),
        ('Спорт', '⚽'), ('Музыка', '🎵'), ('Игры', '🎮'),
        ('Мода', '👗'), ('Путешествия', '✈️'), ('Еда', '🍕')
        ON CONFLICT (name) DO NOTHING;
    `;
    
    try {
        await pool.query(sql);
        console.log('✅ БД инициализирована');
        console.log('✅ Колонки thematic_tags и format_tags добавлены');
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
    }
}

// ==================== АЛИАСЫ БЕЗ /api/ PREFIX ====================
// Фронтенд обращается к /channels, /channels?published=true и тд
// Эти алиасы перенаправляют на /api/* эндпоинты

apiApp.get('/channels', async (req, res) => {
    const { published, limit = 100, category, sortBy, order } = req.query;
    try {
        let query = 'SELECT * FROM channels WHERE 1=1';
        const params = [];
        let paramIdx = 1;
        
        if (published === 'true') {
            query += ` AND is_published = true`;
        }
        
        if (category) {
            query += ` AND category_1 = $${paramIdx++}`;
            params.push(decodeURIComponent(category));
        }
        
        // Сортировка
        const validSortFields = ['subscribers_count', 'created_at', 'rating_average', 'title'];
        const validOrders = ['ASC', 'DESC'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'subscribers_count';
        const sortOrder = validOrders.includes(order?.toUpperCase()) ? order.toUpperCase() : 'DESC';
        
        query += ` ORDER BY ${sortField} ${sortOrder}`;
        query += ` LIMIT $${paramIdx}`;
        params.push(Math.min(parseInt(limit) || 100, 200)); // макс 200
        
        const result = await pool.query(query, params);
        res.json({ success: true, channels: result.rows, total: result.rows.length });
    } catch (error) {
        console.error('❌ /channels error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

apiApp.get('/channels/search', async (req, res) => {
    const { q, category, limit = 50 } = req.query;
    try {
        let query = 'SELECT * FROM channels WHERE is_published = true';
        const params = [];
        let paramIdx = 1;
        
        if (q) {
            query += ` AND (title ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR username ILIKE $${paramIdx})`;
            params.push(`%${q}%`);
            paramIdx++;
        }
        
        if (category) {
            query += ` AND category_1 = $${paramIdx++}`;
            params.push(decodeURIComponent(category));
        }
        
        query += ` ORDER BY subscribers_count DESC LIMIT $${paramIdx}`;
        params.push(Math.min(parseInt(limit) || 50, 100));
        
        const result = await pool.query(query, params);
        res.json({ success: true, channels: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

apiApp.get('/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY name');
        res.json({ success: true, categories: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
apiApp.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== КОНЕЦ АЛИАСОВ ====================

// Запуск API сервера
initDatabase().then(() => {
    apiApp.listen(API_PORT, () => {
        console.log(`🚀 API сервер запущен на порту ${API_PORT}`);
    });
});

// ==================== ТЕЛЕГРАМ БОТ ====================
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = `http://localhost:${API_PORT}/api`;
const API_KEY = process.env.BOT_API_KEY;
const UPDATE_INTERVAL = (process.env.UPDATE_INTERVAL || 6) * 60 * 60 * 1000;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const userChannels = new Map();

// Категории
const CATEGORIES = [
    'Новости', 'Финансы', 'Крипта', 'Технологии',
    'Игры', 'Развлечения', 'Бизнес', 'Образование',
    'Саморазвитие', 'Спорт', 'Лайфстайл', 'Креатив'
];

const THEMATIC_TAGS = {
    'Новости': ['мировые', 'локальные', 'политика', 'экономика'],
    'Финансы': ['инвестиции', 'трейдинг', 'акции', 'банки'],
    'Крипта': ['bitcoin', 'ethereum', 'altcoins', 'defi', 'nft'],
    'Технологии': ['ai', 'ml', 'blockchain', 'cloud', 'mobile'],
    'Игры': ['pc', 'console', 'mobile', 'esports'],
    'Развлечения': ['кино', 'сериалы', 'музыка', 'книги'],
    'Бизнес': ['стартапы', 'маркетинг', 'продажи'],
    'Образование': ['курсы', 'языки', 'программирование'],
    'Саморазвитие': ['психология', 'мотивация', 'здоровье'],
    'Спорт': ['футбол', 'фитнес', 'бег'],
    'Лайфстайл': ['мода', 'путешествия', 'еда'],
    'Креатив': ['дизайн', 'фото', 'видео']
};

const FORMAT_TAGS = [
    'обзоры', 'реакции', 'аналитика', 'гайды', 'новости',
    'подборки', 'стримы', 'live', 'подкаст', 'инсайды'
];

// FSM Сцена
const setupChannelScene = new Scenes.WizardScene(
    'setup_channel',
    
    // Этап 1: Категория
    async (ctx) => {
        console.log('🎬 Этап 1: Выбор категории');
        console.log('   channelData:', ctx.scene.session.channelData ? 'есть' : 'НЕТ!');
        
        const keyboard = CATEGORIES.map(cat => [
            Markup.button.callback(cat, `cat_${cat}`)
        ]);
        
        await ctx.editMessageText(
            '<b>📂 Шаг 1/4: Выберите категорию</b>',
            { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard) }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 2: Тематика
    async (ctx) => {
        const category = ctx.scene.session.category;
        const selectedTags = ctx.scene.session.thematic_tags || [];
        const tags = THEMATIC_TAGS[category] || [];
        
        const keyboard = tags.map(tag => {
            const label = selectedTags.includes(tag) ? `• ${tag}` : tag;
            return [Markup.button.callback(label, `them_${tag}`)];
        });
        
        if (selectedTags.length > 0) {
            keyboard.push([Markup.button.callback('✅ Далее', 'them_done')]);
        }
        
        await ctx.editMessageText(
            `<b>🏷 Шаг 2/4: Тематика</b>\n\n` +
            `Категория: <b>${category}</b>\n` +
            `Выбрано: <b>${selectedTags.length}/5</b>`,
            { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard) }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 3: Формат
    async (ctx) => {
        const category = ctx.scene.session.category;
        const selectedFormats = ctx.scene.session.format_tags || [];
        
        const keyboard = FORMAT_TAGS.map(tag => {
            const label = selectedFormats.includes(tag) ? `• ${tag}` : tag;
            return [Markup.button.callback(label, `fmt_${tag}`)];
        });
        
        keyboard.push([Markup.button.callback('✅ Далее', 'fmt_done')]);
        
        await ctx.editMessageText(
            `<b>📋 Шаг 3/4: Формат</b>\n\n` +
            `Выбрано: <b>${selectedFormats.length}/3</b>`,
            { parse_mode: 'HTML', ...Markup.inlineKeyboard(keyboard) }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 4: Описание
    async (ctx) => {
        await ctx.editMessageText(
            '<b>📝 Шаг 4/4: Описание</b>\n\nНапишите описание (макс 300 символов):',
            { parse_mode: 'HTML' }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 5: Превью
    async (ctx) => {
        console.log('🎬 Этап 5: Превью');
        
        if (ctx.message?.text) {
            const description = ctx.message.text.trim();
            
            if (description.length > 300) {
                await ctx.reply(`⚠️ Слишком длинно! (${description.length}/300)`);
                return;
            }
            
            ctx.scene.session.description = description;
        }
        
        const { category, thematic_tags, format_tags, description, channelData } = ctx.scene.session;
        
        console.log('   Данные сессии:');
        console.log('   - category:', category);
        console.log('   - thematic_tags:', thematic_tags);
        console.log('   - format_tags:', format_tags);
        console.log('   - description:', description ? 'есть' : 'нет');
        console.log('   - channelData:', channelData ? 'есть' : 'НЕТ!');
        
        if (!channelData) {
            console.error('❌ channelData потеряна!');
            await ctx.reply('❌ Ошибка: данные канала потеряны. Попробуйте /my_channels снова.');
            return ctx.scene.leave();
        }
        
        const preview = 
            `<b>📋 Превью</b>\n\n` +
            `📢 <b>${channelData.title}</b>\n` +
            `👥 ${channelData.subscribers_count?.toLocaleString() || 0}\n\n` +
            `📂 ${category}\n` +
            `🏷 ${thematic_tags?.join(', ') || ''}\n` +
            `📋 ${format_tags?.join(', ') || ''}\n\n` +
            `📝 ${description || ''}`;
        
        await ctx.reply(preview, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Опубликовать', 'confirm_publish')],
                [Markup.button.callback('❌ Отмена', 'cancel_setup')]
            ])
        });
        
        return ctx.wizard.next();
    }
);

// Обработчики
setupChannelScene.action(/^cat_(.+)$/, async (ctx) => {
    ctx.scene.session.category = ctx.match[1];
    ctx.scene.session.thematic_tags = [];
    await ctx.answerCbQuery();
    await ctx.wizard.selectStep(1);
    return ctx.wizard.steps[ctx.wizard.cursor](ctx);
});

setupChannelScene.action(/^them_(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    
    if (action === 'done') {
        await ctx.answerCbQuery();
        ctx.scene.session.format_tags = [];
        await ctx.wizard.selectStep(2);
        return ctx.wizard.steps[ctx.wizard.cursor](ctx);
    }
    
    const selectedTags = ctx.scene.session.thematic_tags || [];
    
    if (selectedTags.includes(action)) {
        ctx.scene.session.thematic_tags = selectedTags.filter(t => t !== action);
    } else {
        if (selectedTags.length >= 5) {
            await ctx.answerCbQuery('⚠️ Максимум 5!', { show_alert: true });
            return;
        }
        ctx.scene.session.thematic_tags = [...selectedTags, action];
    }
    
    await ctx.answerCbQuery();
    await ctx.wizard.selectStep(1);
    return ctx.wizard.steps[ctx.wizard.cursor](ctx);
});

setupChannelScene.action(/^fmt_(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    
    if (action === 'done') {
        await ctx.answerCbQuery();
        await ctx.wizard.selectStep(3);
        return ctx.wizard.steps[ctx.wizard.cursor](ctx);
    }
    
    const selectedFormats = ctx.scene.session.format_tags || [];
    
    if (selectedFormats.includes(action)) {
        ctx.scene.session.format_tags = selectedFormats.filter(t => t !== action);
    } else {
        if (selectedFormats.length >= 3) {
            await ctx.answerCbQuery('⚠️ Максимум 3!', { show_alert: true });
            return;
        }
        ctx.scene.session.format_tags = [...selectedFormats, action];
    }
    
    await ctx.answerCbQuery();
    await ctx.wizard.selectStep(2);
    return ctx.wizard.steps[ctx.wizard.cursor](ctx);
});

setupChannelScene.action('confirm_publish', async (ctx) => {
    await ctx.answerCbQuery();
    await publishChannel(ctx);
    return ctx.scene.leave();
});

setupChannelScene.action('cancel_setup', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('❌ Отменено');
    return ctx.scene.leave();
});

const stage = new Scenes.Stage([setupChannelScene]);

bot.use(session());
bot.use(stage.middleware());

// Команды
bot.start(async (ctx) => {
    await ctx.replyWithHTML(
        `👋 Привет, <b>${ctx.from.first_name}</b>!\n\n` +
        `Добавь меня в админы канала и используй /my_channels`,
        Markup.inlineKeyboard([[Markup.button.callback('📢 Мои каналы', 'show_channels')]])
    );
});

bot.command('my_channels', async (ctx) => showMyChannels(ctx));

bot.action('show_channels', async (ctx) => {
    await ctx.answerCbQuery();
    await showMyChannels(ctx);
});

bot.action(/^setup_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const channelId = ctx.match[1];
    const userId = ctx.from.id;
    const channels = userChannels.get(userId) || [];
    const channel = channels.find(ch => ch.channel_id.toString() === channelId);
    
    if (!channel) {
        await ctx.reply('⚠️ Канал не найден');
        return;
    }
    
    // Входим в сцену
    await ctx.scene.enter('setup_channel');
    
    // ВАЖНО: Сохраняем channelData в session ПОСЛЕ входа
    ctx.scene.session.channelData = channel;
});

// Добавление бота
bot.on('my_chat_member', async (ctx) => {
    const update = ctx.update.my_chat_member;
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;
    const userId = update.from.id;
    
    if (newStatus === 'administrator') {
        const stats = await getChannelStats(ctx, chat);
        
        if (stats) {
            if (!userChannels.has(userId)) {
                userChannels.set(userId, []);
            }
            
            const channels = userChannels.get(userId);
            if (!channels.find(ch => ch.channel_id === chat.id)) {
                channels.push(stats);
            }
            
            await saveChannelToDB(stats, userId);
            
            try {
                await ctx.telegram.sendMessage(
                    userId,
                    `✅ Канал подключён!\n\n📢 ${stats.title}\n👥 ${stats.subscribers_count.toLocaleString()}\n\nИспользуй /my_channels`,
                    Markup.inlineKeyboard([[Markup.button.callback('⚙️ Настроить', `setup_${chat.id}`)]])
                );
            } catch (e) {}
        }
    }
    
    if (newStatus === 'left' || newStatus === 'kicked') {
        const channels = userChannels.get(userId) || [];
        const index = channels.findIndex(ch => ch.channel_id === chat.id);
        if (index !== -1) channels.splice(index, 1);
    }
});

// Функции
async function showMyChannels(ctx) {
    const userId = ctx.from.id;
    await loadUserChannelsFromDB(userId);
    
    const channels = userChannels.get(userId) || [];
    
    if (channels.length === 0) {
        await ctx.reply('📭 Нет каналов. Добавь меня в админы!');
        return;
    }
    
    let message = `📢 Ваши каналы (${channels.length}):\n\n`;
    const buttons = [];
    
    channels.forEach((ch, i) => {
        const status = ch.is_published ? '✅' : '⚪';
        message += `${i + 1}. ${ch.title} ${status}\n`;
        buttons.push([Markup.button.callback(`⚙️ ${ch.title}`, `setup_${ch.channel_id}`)]);
    });
    
    await ctx.replyWithHTML(message, Markup.inlineKeyboard(buttons));
}

async function publishChannel(ctx) {
    const { category, thematic_tags, format_tags, description, channelData } = ctx.scene.session;
    
    await ctx.reply('⏳ Публикую...');
    
    try {
        await sendChannelToAPI({
            channel_id: channelData.channel_id,
            title: channelData.title,
            username: channelData.username,
            description: description,
            subscribers_count: channelData.subscribers_count,
            photo_url: channelData.photo_url,
            category_1: category,
            thematic_tags: thematic_tags,
            format_tags: format_tags,
            owner_telegram_id: ctx.from.id,
            owner_username: ctx.from.username,
            is_published: true
        });
        
        await ctx.reply('✅ Опубликовано!');
    } catch (error) {
        await ctx.reply(`❌ Ошибка: ${error.message}`);
    }
}

async function getChannelStats(ctx, chat) {
    try {
        const chatInfo = await ctx.telegram.getChat(chat.id);
        const membersCount = await ctx.telegram.getChatMembersCount(chat.id);
        
        return {
            channel_id: chat.id,
            title: chatInfo.title,
            username: chatInfo.username || null,
            subscribers_count: membersCount,
            photo_url: null,
            is_published: false
        };
    } catch (error) {
        console.error('❌ Ошибка статистики:', error.message);
        return null;
    }
}

async function loadUserChannelsFromDB(userId) {
    try {
        const response = await axios.get(`${API_URL}/channels/user/${userId}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` },
            timeout: 5000
        });
        
        if (response.data.success) {
            userChannels.set(userId, response.data.channels);
        }
    } catch (error) {
        console.log('⚠️ Не удалось загрузить каналы из БД');
    }
}

async function saveChannelToDB(channelData, userId) {
    try {
        await axios.post(`${API_URL}/channels/save`, {
            ...channelData,
            owner_telegram_id: userId,
            is_published: false
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
    } catch (error) {
        console.log('⚠️ Не удалось сохранить в БД');
    }
}

async function sendChannelToAPI(data) {
    try {
        await axios.post(`${API_URL}/channels/update-stats`, data, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
    } catch (error) {
        throw new Error(error.response?.data?.error || error.message);
    }
}

// Запуск бота
console.log('⏳ Запуск Telegram бота через 3 секунды...');

setTimeout(() => {
    console.log('🚀 Инициализация бота...');
    
    if (!BOT_TOKEN) {
        console.error('❌ BOT_TOKEN отсутствует!');
        return;
    }
    
    bot.launch()
        .then(() => {
            console.log('✅ Бот успешно запущен!');
            console.log(`   Bot ID: ${bot.botInfo.id}`);
            console.log(`   Username: @${bot.botInfo.username}`);
            console.log(`   Name: ${bot.botInfo.first_name}`);
            console.log('\n🎉 Система полностью готова!\n');
        })
        .catch(error => {
            console.error('❌ Ошибка запуска бота:', error);
            console.error('   Сообщение:', error.message);
            console.error('   Code:', error.code || 'N/A');
            
            if (error.code === 409) {
                console.error('\n⚠️ Конфликт: другой экземпляр бота уже запущен!');
                console.error('   Остановите другие процессы или используйте webhook\n');
            }
        });
}, 3000);

process.once('SIGINT', () => {
    console.log('\n👋 Остановка бота...');
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    console.log('\n👋 Остановка бота...');
    bot.stop('SIGTERM');
});
