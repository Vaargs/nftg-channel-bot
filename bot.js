// bot.js - Улучшенный бот с FSM и многошаговой настройкой каналов
require('dotenv').config();
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_URL = process.env.API_URL;
const API_KEY = process.env.BOT_API_KEY;
const UPDATE_INTERVAL = (process.env.UPDATE_INTERVAL || 6) * 60 * 60 * 1000;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден в .env файле');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Хранилище каналов владельца (загружается из БД при старте)
const userChannels = new Map(); // userId -> [channels]

// Категории
const CATEGORIES = [
    'Новости', 'Финансы', 'Крипта', 'Технологии',
    'Игры', 'Развлечения', 'Бизнес', 'Образование',
    'Саморазвитие', 'Спорт', 'Лайфстайл', 'Креатив'
];

// Тематические теги по категориям
const THEMATIC_TAGS = {
    'Новости': ['мировые', 'локальные', 'политика', 'экономика', 'общество', 'происшествия', 'наука', 'культура', 'спорт', 'технологии'],
    'Финансы': ['инвестиции', 'трейдинг', 'акции', 'облигации', 'фонды', 'банки', 'экономика', 'бюджет', 'налоги', 'страхование'],
    'Крипта': ['bitcoin', 'ethereum', 'altcoins', 'defi', 'nft', 'mining', 'trading', 'news', 'аналитика', 'ico'],
    'Технологии': ['ai', 'ml', 'blockchain', 'iot', 'cloud', 'mobile', 'web', 'devops', 'security', 'hardware'],
    'Игры': ['pc', 'console', 'mobile', 'mmo', 'fps', 'rpg', 'strategy', 'indie', 'esports', 'reviews'],
    'Развлечения': ['кино', 'сериалы', 'музыка', 'книги', 'мемы', 'юмор', 'тренды', 'знаменитости', 'фестивали', 'театр'],
    'Бизнес': ['стартапы', 'менеджмент', 'маркетинг', 'продажи', 'предпринимательство', 'franchise', 'b2b', 'b2c', 'консалтинг', 'hr'],
    'Образование': ['онлайн-курсы', 'языки', 'программирование', 'дизайн', 'маркетинг', 'бизнес', 'наука', 'школа', 'вуз', 'саморазвитие'],
    'Саморазвитие': ['психология', 'мотивация', 'продуктивность', 'здоровье', 'привычки', 'медитация', 'книги', 'карьера', 'отношения', 'финансы'],
    'Спорт': ['футбол', 'баскетбол', 'хоккей', 'теннис', 'единоборства', 'фитнес', 'бег', 'плавание', 'киберспорт', 'экстрим'],
    'Лайфстайл': ['мода', 'красота', 'путешествия', 'еда', 'дом', 'семья', 'здоровье', 'хобби', 'pets', 'авто'],
    'Креатив': ['дизайн', 'фото', 'видео', 'искусство', 'музыка', 'писательство', 'архитектура', '3d', 'animation', 'illustration']
};

// Форматные теги (для всех категорий)
const FORMAT_TAGS = [
    'обзоры', 'реакции', 'аналитика', 'гайды', 'новости',
    'подборки', 'стримы', 'live', 'подкаст', 'инсайды'
];

// ==================== FSM СЦЕНЫ ====================

// Сцена настройки канала
const setupChannelScene = new Scenes.WizardScene(
    'setup_channel',
    
    // Этап 1: Выбор категории
    async (ctx) => {
        const keyboard = CATEGORIES.map(cat => [
            Markup.button.callback(cat, `cat_${cat}`)
        ]);
        
        await ctx.editMessageText(
            '<b>📂 Шаг 1/4: Выберите категорию</b>\n\n' +
            'Выберите ОДНУ категорию, которая лучше всего описывает ваш канал:',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(keyboard)
            }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 2: Тематические теги
    async (ctx) => {
        const category = ctx.scene.session.category;
        const selectedTags = ctx.scene.session.thematic_tags || [];
        const page = ctx.scene.session.themPage || 0;
        
        const tags = THEMATIC_TAGS[category] || [];
        const perPage = 10;
        const start = page * perPage;
        const pageTags = tags.slice(start, start + perPage);
        
        const keyboard = pageTags.map(tag => {
            const isSelected = selectedTags.includes(tag);
            const label = isSelected ? `• ${tag}` : tag;
            return [Markup.button.callback(label, `them_${tag}`)];
        });
        
        // Пагинация
        const paginationRow = [];
        if (page > 0) {
            paginationRow.push(Markup.button.callback('◀️ Назад', 'them_prev'));
        }
        if (start + perPage < tags.length) {
            paginationRow.push(Markup.button.callback('Вперёд ▶️', 'them_next'));
        }
        if (paginationRow.length > 0) {
            keyboard.push(paginationRow);
        }
        
        // Кнопка "Далее"
        if (selectedTags.length > 0) {
            keyboard.push([Markup.button.callback('✅ Далее', 'them_done')]);
        }
        
        await ctx.editMessageText(
            `<b>🏷 Шаг 2/4: Тематические теги</b>\n\n` +
            `Категория: <b>${category}</b>\n\n` +
            `Выберите до 5 тегов, которые описывают тематику вашего канала.\n\n` +
            `Выбрано: <b>${selectedTags.length}/5</b>\n` +
            (selectedTags.length > 0 ? `\nВыбранные: ${selectedTags.map(t => `• ${t}`).join(', ')}` : ''),
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(keyboard)
            }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 3: Форматные теги
    async (ctx) => {
        const category = ctx.scene.session.category;
        const thematicTags = ctx.scene.session.thematic_tags || [];
        const selectedFormats = ctx.scene.session.format_tags || [];
        
        const keyboard = FORMAT_TAGS.map(tag => {
            const isSelected = selectedFormats.includes(tag);
            const label = isSelected ? `• ${tag}` : tag;
            return [Markup.button.callback(label, `fmt_${tag}`)];
        });
        
        // Кнопка "Далее" (можно пропустить этап)
        keyboard.push([Markup.button.callback('✅ Далее', 'fmt_done')]);
        
        await ctx.editMessageText(
            `<b>📋 Шаг 3/4: Форматные теги</b>\n\n` +
            `Категория: <b>${category}</b>\n` +
            `Тематика: ${thematicTags.map(t => `• ${t}`).join(', ')}\n\n` +
            `Выберите до 3 форматных тегов (необязательно).\n\n` +
            `Выбрано: <b>${selectedFormats.length}/3</b>\n` +
            (selectedFormats.length > 0 ? `\nВыбранные: ${selectedFormats.map(t => `• ${t}`).join(', ')}` : ''),
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(keyboard)
            }
        );
        
        return ctx.wizard.next();
    },
    
    // Этап 4: Описание
    async (ctx) => {
        await ctx.editMessageText(
            '<b>📝 Шаг 4/4: Описание канала</b>\n\n' +
            'Напишите краткое описание вашего канала (максимум 300 символов).\n\n' +
            'Описание поможет пользователям понять, о чём ваш канал.',
            { parse_mode: 'HTML' }
        );
        
        return ctx.wizard.next();
    },
    
    // Финальный этап: Подтверждение
    async (ctx) => {
        if (ctx.message && ctx.message.text) {
            const description = ctx.message.text.trim();
            
            if (description.length > 300) {
                await ctx.reply(
                    '⚠️ Описание слишком длинное!\n\n' +
                    `Текущая длина: ${description.length} символов\n` +
                    `Максимум: 300 символов\n\n` +
                    'Пожалуйста, сократите описание и отправьте снова.'
                );
                return;
            }
            
            ctx.scene.session.description = description;
        }
        
        // Показываем превью
        const { category, thematic_tags, format_tags, description, channelId, channelData } = ctx.scene.session;
        
        const preview = 
            `<b>📋 Превью канала</b>\n\n` +
            `📢 <b>${channelData.title}</b>\n` +
            `👥 ${channelData.subscribersCount.toLocaleString()} подписчиков\n\n` +
            `📂 Категория: <b>${category}</b>\n` +
            `🏷 Тематика: ${thematic_tags.map(t => `• ${t}`).join(', ')}\n` +
            (format_tags.length > 0 ? `📋 Формат: ${format_tags.map(t => `• ${t}`).join(', ')}\n` : '') +
            `\n📝 Описание:\n${description}\n\n` +
            `Всё верно?`;
        
        await ctx.reply(preview, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Подтвердить и опубликовать', 'confirm_publish')],
                [Markup.button.callback('✏️ Изменить', 'edit_channel')],
                [Markup.button.callback('❌ Отмена', 'cancel_setup')]
            ])
        });
        
        return ctx.wizard.next();
    }
);

// Обработчики callback'ов внутри сцены
setupChannelScene.action(/^cat_(.+)$/, async (ctx) => {
    const category = ctx.match[1];
    ctx.scene.session.category = category;
    ctx.scene.session.thematic_tags = [];
    ctx.scene.session.themPage = 0;
    
    await ctx.answerCbQuery(`✅ Выбрана: ${category}`);
    
    // Переходим к этапу 2 и перерисовываем
    await ctx.wizard.selectStep(1);
    return ctx.wizard.steps[ctx.wizard.cursor](ctx);
});

setupChannelScene.action(/^them_(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    
    if (action === 'prev') {
        ctx.scene.session.themPage = Math.max(0, (ctx.scene.session.themPage || 0) - 1);
        await ctx.answerCbQuery();
        await ctx.wizard.selectStep(1);
        return ctx.wizard.steps[ctx.wizard.cursor](ctx);
    }
    
    if (action === 'next') {
        ctx.scene.session.themPage = (ctx.scene.session.themPage || 0) + 1;
        await ctx.answerCbQuery();
        await ctx.wizard.selectStep(1);
        return ctx.wizard.steps[ctx.wizard.cursor](ctx);
    }
    
    if (action === 'done') {
        const selectedTags = ctx.scene.session.thematic_tags || [];
        if (selectedTags.length === 0) {
            await ctx.answerCbQuery('⚠️ Выберите хотя бы 1 тег!', { show_alert: true });
            return;
        }
        
        await ctx.answerCbQuery('✅ Переход к форматным тегам');
        ctx.scene.session.format_tags = [];
        await ctx.wizard.selectStep(2);
        return ctx.wizard.steps[ctx.wizard.cursor](ctx);
    }
    
    // Toggle tag
    const tag = action;
    const selectedTags = ctx.scene.session.thematic_tags || [];
    
    if (selectedTags.includes(tag)) {
        ctx.scene.session.thematic_tags = selectedTags.filter(t => t !== tag);
        await ctx.answerCbQuery(`❌ Убран: ${tag}`);
    } else {
        if (selectedTags.length >= 5) {
            await ctx.answerCbQuery('⚠️ Максимум 5 тегов!', { show_alert: true });
            return;
        }
        ctx.scene.session.thematic_tags = [...selectedTags, tag];
        await ctx.answerCbQuery(`✅ Добавлен: ${tag}`);
    }
    
    // Перерисовываем клавиатуру
    await ctx.wizard.selectStep(1);
    return ctx.wizard.steps[ctx.wizard.cursor](ctx);
});

setupChannelScene.action(/^fmt_(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    
    if (action === 'done') {
        await ctx.answerCbQuery('✅ Переход к описанию');
        await ctx.wizard.selectStep(3);
        return ctx.wizard.steps[ctx.wizard.cursor](ctx);
    }
    
    // Toggle tag
    const tag = action;
    const selectedFormats = ctx.scene.session.format_tags || [];
    
    if (selectedFormats.includes(tag)) {
        ctx.scene.session.format_tags = selectedFormats.filter(t => t !== tag);
        await ctx.answerCbQuery(`❌ Убран: ${tag}`);
    } else {
        if (selectedFormats.length >= 3) {
            await ctx.answerCbQuery('⚠️ Максимум 3 тега!', { show_alert: true });
            return;
        }
        ctx.scene.session.format_tags = [...selectedFormats, tag];
        await ctx.answerCbQuery(`✅ Добавлен: ${tag}`);
    }
    
    // Перерисовываем клавиатуру
    await ctx.wizard.selectStep(2);
    return ctx.wizard.steps[ctx.wizard.cursor](ctx);
});

setupChannelScene.action('confirm_publish', async (ctx) => {
    await ctx.answerCbQuery();
    await publishChannel(ctx);
    return ctx.scene.leave();
});

setupChannelScene.action('edit_channel', async (ctx) => {
    await ctx.answerCbQuery('Начинаем заново');
    return ctx.wizard.selectStep(0);
});

setupChannelScene.action('cancel_setup', async (ctx) => {
    await ctx.answerCbQuery('Настройка отменена');
    await ctx.reply('❌ Настройка канала отменена');
    return ctx.scene.leave();
});

// Создаём Stage
const stage = new Scenes.Stage([setupChannelScene]);

// Middleware
bot.use(session());
bot.use(stage.middleware());

// ==================== КОМАНДЫ ====================

bot.start(async (ctx) => {
    const firstName = ctx.from.first_name || 'друг';
    
    await ctx.replyWithHTML(
        `👋 Привет, <b>${firstName}</b>!\n\n` +
        `Я бот <b>NFTG-ZONIX</b> для добавления каналов в навигатор!\n\n` +
        `🎯 <b>Что я умею:</b>\n` +
        `• Собирать статистику канала\n` +
        `• Помочь настроить категории и теги\n` +
        `• Опубликовать канал в ZONIX\n` +
        `• Автоматически обновлять подписчиков\n\n` +
        `📌 <b>Как начать:</b>\n` +
        `1. Добавь меня в админы своего канала\n` +
        `2. Дай права "View channel stats"\n` +
        `3. Вернись сюда и нажми /my_channels\n\n` +
        `Готов начать? 🚀`,
        Markup.inlineKeyboard([
            [Markup.button.callback('📢 Мои каналы', 'show_my_channels')],
            [Markup.button.callback('ℹ️ Инструкция', 'show_help')]
        ])
    );
});

bot.command('my_channels', async (ctx) => {
    await showMyChannels(ctx);
});

// ==================== ОБРАБОТЧИКИ ====================

bot.action('show_my_channels', async (ctx) => {
    await ctx.answerCbQuery();
    await showMyChannels(ctx);
});

bot.action('show_help', async (ctx) => {
    await ctx.answerCbQuery();
    await showHelp(ctx);
});

bot.action(/^setup_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const channelId = ctx.match[1];
    await startChannelSetup(ctx, channelId);
});

// ==================== МОИ КАНАЛЫ ====================

async function showMyChannels(ctx) {
    const userId = ctx.from.id;
    
    // Загружаем каналы пользователя из БД
    await loadUserChannelsFromDB(userId);
    
    const channels = userChannels.get(userId) || [];
    
    if (channels.length === 0) {
        await ctx.reply(
            `📭 <b>У вас нет подключённых каналов</b>\n\n` +
            `Чтобы добавить канал:\n` +
            `1. Зайдите в настройки канала\n` +
            `2. Administrators → Add Administrator\n` +
            `3. Найдите @${ctx.botInfo.username}\n` +
            `4. Дайте права "View channel stats"\n` +
            `5. Вернитесь сюда!`,
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    let message = `📢 <b>Ваши каналы (${channels.length}):</b>\n\n`;
    
    const buttons = [];
    
    channels.forEach((channel, index) => {
        const status = channel.is_published ? '✅ Опубликован' : '⚪ Не опубликован';
        const subs = channel.subscribers_count.toLocaleString();
        
        message += `${index + 1}. <b>${channel.title}</b>\n`;
        message += `   👥 ${subs} подписчиков\n`;
        message += `   📊 Статус: ${status}\n\n`;
        
        buttons.push([
            Markup.button.callback(
                `⚙️ ${channel.title}`,
                `setup_${channel.channel_id}`
            )
        ]);
    });
    
    await ctx.replyWithHTML(
        message,
        Markup.inlineKeyboard(buttons)
    );
}

async function startChannelSetup(ctx, channelId) {
    const userId = ctx.from.id;
    const channels = userChannels.get(userId) || [];
    const channel = channels.find(ch => ch.channel_id.toString() === channelId);
    
    if (!channel) {
        await ctx.reply('⚠️ Канал не найден. Возможно, бот был удалён из админов.');
        return;
    }
    
    // Инициализируем сцену с данными канала
    await ctx.scene.enter('setup_channel', {
        channelId: channelId,
        channelData: channel
    });
}

// ==================== ПУБЛИКАЦИЯ ====================

async function publishChannel(ctx) {
    const { category, thematic_tags, format_tags, description, channelId, channelData } = ctx.scene.session;
    
    await ctx.reply('⏳ Публикую канал в ZONIX...');
    
    try {
        const data = {
            channel_id: channelData.channel_id,
            title: channelData.title,
            username: channelData.username,
            description: description,
            subscribers_count: channelData.subscribers_count,
            photo_url: channelData.photo_url,
            category_1: category,
            category_2: thematic_tags[0] || null,
            category_3: format_tags[0] || null,
            owner_telegram_id: ctx.from.id,
            owner_username: ctx.from.username,
            is_published: true,
            is_verified: true,
            bot_is_admin: true,
            thematic_tags: thematic_tags,
            format_tags: format_tags
        };
        
        await sendChannelToAPI(data);
        
        // Обновляем локальные данные
        const userId = ctx.from.id;
        const channels = userChannels.get(userId) || [];
        const channelIndex = channels.findIndex(ch => ch.channel_id.toString() === channelId);
        
        if (channelIndex !== -1) {
            channels[channelIndex].is_published = true;
            channels[channelIndex].category = category;
            channels[channelIndex].thematic_tags = thematic_tags;
            channels[channelIndex].format_tags = format_tags;
            channels[channelIndex].description = description;
        }
        
        await ctx.replyWithHTML(
            `✅ <b>Канал успешно опубликован в ZONIX!</b>\n\n` +
            `📢 ${channelData.title}\n` +
            `👥 ${channelData.subscribers_count.toLocaleString()} подписчиков\n\n` +
            `Ваш канал теперь виден всем пользователям ZONIX!\n` +
            `Статистика будет обновляться автоматически каждые ${UPDATE_INTERVAL / 3600000} часов.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('📢 Мои каналы', 'show_my_channels')]
            ])
        );
        
    } catch (error) {
        console.error('❌ Ошибка публикации:', error);
        await ctx.reply(
            `❌ Ошибка при публикации канала:\n${error.message}\n\n` +
            `Попробуйте позже или обратитесь в поддержку.`
        );
    }
}

// ==================== ОБРАБОТКА ДОБАВЛЕНИЯ БОТА ====================

bot.on('my_chat_member', async (ctx) => {
    try {
        const update = ctx.update.my_chat_member;
        const chat = update.chat;
        const newStatus = update.new_chat_member.status;
        const userId = update.from.id;
        
        if (newStatus === 'administrator') {
            console.log(`✅ Бот добавлен: ${chat.title} (${chat.id})`);
            
            const stats = await getChannelStats(ctx, chat);
            
            if (stats) {
                // Добавляем канал в локальное хранилище
                if (!userChannels.has(userId)) {
                    userChannels.set(userId, []);
                }
                
                const channels = userChannels.get(userId);
                const existing = channels.find(ch => ch.channel_id === chat.id);
                
                if (!existing) {
                    channels.push(stats);
                }
                
                // Сохраняем в БД как неопубликованный
                await saveChannelToDB(stats, userId);
                
                // Уведомляем владельца
                try {
                    await ctx.telegram.sendMessage(
                        userId,
                        `✅ <b>Канал подключён!</b>\n\n` +
                        `📢 <b>${stats.title}</b>\n` +
                        `👥 Подписчиков: <b>${stats.subscribers_count.toLocaleString()}</b>\n` +
                        `🔗 Username: ${stats.username ? '@' + stats.username : 'Приватный'}\n\n` +
                        `Теперь используйте /my_channels для настройки!`,
                        { 
                            parse_mode: 'HTML',
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback('⚙️ Настроить канал', `setup_${chat.id}`)]
                            ])
                        }
                    );
                } catch (e) {
                    console.log('⚠️ Не удалось отправить уведомление владельцу');
                }
            }
        }
        
        if (newStatus === 'left' || newStatus === 'kicked') {
            console.log(`❌ Бот удалён: ${chat.title} (${chat.id})`);
            
            // Удаляем из локального хранилища
            const channels = userChannels.get(userId) || [];
            const index = channels.findIndex(ch => ch.channel_id === chat.id);
            if (index !== -1) {
                channels.splice(index, 1);
            }
            
            // Удаляем из БД
            await removeChannelFromDB(chat.id);
        }
        
    } catch (error) {
        console.error('❌ Ошибка обработки my_chat_member:', error);
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function getChannelStats(ctx, chat) {
    try {
        const chatInfo = await ctx.telegram.getChat(chat.id);
        const membersCount = await ctx.telegram.getChatMembersCount(chat.id);
        
        let photoUrl = null;
        if (chatInfo.photo) {
            try {
                const photo = await ctx.telegram.getFile(chatInfo.photo.big_file_id);
                photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${photo.file_path}`;
            } catch (e) {
                console.log('⚠️ Не удалось получить фото канала');
            }
        }
        
        return {
            channel_id: chat.id,
            title: chatInfo.title,
            username: chatInfo.username || null,
            subscribers_count: membersCount,
            photo_url: photoUrl,
            type: chatInfo.type,
            is_published: false,
            last_update: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        return null;
    }
}

async function loadUserChannelsFromDB(userId) {
    if (!API_URL || !API_KEY) {
        console.log('⚠️ API не настроен');
        return;
    }
    
    try {
        const response = await axios.get(
            `${API_URL}/channels/user/${userId}`,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`
                },
                timeout: 10000
            }
        );
        
        if (response.data.success && response.data.channels) {
            userChannels.set(userId, response.data.channels);
            console.log(`✅ Загружено ${response.data.channels.length} каналов для пользователя ${userId}`);
        }
        
    } catch (error) {
        if (error.code !== 'ECONNREFUSED') {
            console.error('❌ Ошибка загрузки каналов из БД:', error.message);
        }
    }
}

async function saveChannelToDB(channelData, userId) {
    if (!API_URL || !API_KEY) return;
    
    try {
        await axios.post(
            `${API_URL}/channels/save`,
            {
                ...channelData,
                owner_telegram_id: userId,
                is_published: false
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        console.log(`✅ Канал сохранён в БД: ${channelData.title}`);
        
    } catch (error) {
        console.error('❌ Ошибка сохранения в БД:', error.message);
    }
}

async function sendChannelToAPI(channelData) {
    if (!API_URL || !API_KEY) {
        console.log('⚠️ API не настроен, данные не отправлены');
        return;
    }
    
    try {
        const response = await axios.post(
            `${API_URL}/channels/update-stats`,
            channelData,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        console.log(`✅ Канал опубликован: ${response.data.action}`);
        
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error('Сервер недоступен');
        } else {
            throw new Error(error.response?.data?.error || error.message);
        }
    }
}

async function removeChannelFromDB(channelId) {
    if (!API_URL || !API_KEY) return;
    
    try {
        await axios.delete(
            `${API_URL}/channels/${channelId}`,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`
                },
                timeout: 10000
            }
        );
        
        console.log(`✅ Канал ${channelId} удалён из БД`);
        
    } catch (error) {
        console.error('❌ Ошибка удаления из БД:', error.message);
    }
}

async function showHelp(ctx) {
    await ctx.replyWithHTML(
        `📖 <b>Инструкция по использованию</b>\n\n` +
        `<b>1. Добавление бота в канал:</b>\n` +
        `   • Откройте настройки канала\n` +
        `   • Administrators → Add Administrator\n` +
        `   • Найдите @${ctx.botInfo.username}\n` +
        `   • ✅ Включите "View channel stats"\n` +
        `   • Сохраните\n\n` +
        `<b>2. Настройка канала:</b>\n` +
        `   • Вернитесь в бота\n` +
        `   • Нажмите /my_channels\n` +
        `   • Выберите канал\n` +
        `   • Пройдите 4 шага настройки\n` +
        `   • Опубликуйте!\n\n` +
        `<b>3. Что дальше:</b>\n` +
        `   • Канал появится в навигаторе ZONIX\n` +
        `   • Статистика обновляется каждые ${UPDATE_INTERVAL / 3600000}ч\n` +
        `   • Пользователи могут оставлять отзывы`,
        Markup.inlineKeyboard([
            [Markup.button.callback('📢 Мои каналы', 'show_my_channels')]
        ])
    );
}

// Автообновление статистики каналов
async function updateAllChannels() {
    console.log(`\n🔄 Автообновление каналов...`);
    
    for (const [userId, channels] of userChannels) {
        for (const channel of channels) {
            try {
                // Обновляем только опубликованные
                if (!channel.is_published) continue;
                
                const chat = await bot.telegram.getChat(channel.channel_id);
                const membersCount = await bot.telegram.getChatMembersCount(channel.channel_id);
                
                channel.subscribers_count = membersCount;
                channel.last_update = new Date().toISOString();
                
                // Обновляем в БД
                await sendChannelToAPI(channel);
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`❌ Ошибка обновления ${channel.channel_id}:`, error.message);
            }
        }
    }
    
    console.log('✅ Автообновление завершено');
}

// Загружаем все каналы при старте бота
async function loadAllChannelsOnStart() {
    if (!API_URL || !API_KEY) {
        console.log('⚠️ API не настроен, пропускаем загрузку каналов');
        return;
    }
    
    try {
        const response = await axios.get(
            `${API_URL}/channels/all`,
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`
                },
                timeout: 10000
            }
        );
        
        if (response.data.success && response.data.channels) {
            // Группируем каналы по владельцам
            response.data.channels.forEach(channel => {
                const userId = channel.owner_telegram_id;
                if (userId) {
                    if (!userChannels.has(userId)) {
                        userChannels.set(userId, []);
                    }
                    userChannels.get(userId).push(channel);
                }
            });
            
            console.log(`✅ Загружено ${response.data.channels.length} каналов из БД`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка загрузки каналов при старте:', error.message);
    }
}

// ==================== ЗАПУСК ====================

bot.launch()
    .then(async () => {
        console.log('🤖 Бот запущен!');
        console.log(`   Username: @${bot.botInfo.username}`);
        console.log(`   API URL: ${API_URL || 'не настроен'}`);
        
        // Загружаем все каналы из БД
        await loadAllChannelsOnStart();
        
        // Запускаем автообновление
        setInterval(updateAllChannels, UPDATE_INTERVAL);
        console.log(`✅ Автообновление: каждые ${UPDATE_INTERVAL / 3600000}ч\n`);
    })
    .catch(error => {
        console.error('❌ Ошибка запуска бота:', error);
        process.exit(1);
    });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
