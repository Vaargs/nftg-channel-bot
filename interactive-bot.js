// interactive-bot.js - Интерактивный бот для добавления каналов в ZONIX
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
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

// Хранилище временных данных пользователей
const userSessions = new Map();

// Список доступных категорий
const CATEGORIES = [
    { name: 'Технологии', emoji: '💻' },
    { name: 'Новости', emoji: '📰' },
    { name: 'Бизнес', emoji: '💼' },
    { name: 'Криптовалюты', emoji: '₿' },
    { name: 'Образование', emoji: '📚' },
    { name: 'Развлечения', emoji: '🎬' },
    { name: 'Спорт', emoji: '⚽' },
    { name: 'Музыка', emoji: '🎵' },
    { name: 'Игры', emoji: '🎮' },
    { name: 'Мода', emoji: '👗' },
    { name: 'Путешествия', emoji: '✈️' },
    { name: 'Еда', emoji: '🍕' },
    { name: 'Здоровье', emoji: '💪' },
    { name: 'Наука', emoji: '🔬' },
    { name: 'Искусство', emoji: '🎨' },
    { name: 'Авто', emoji: '🚗' },
    { name: 'Недвижимость', emoji: '🏠' },
    { name: 'Маркетинг', emoji: '📊' },
    { name: 'Фото', emoji: '📷' },
    { name: 'Саморазвитие', emoji: '🌱' }
];

// Хранилище каналов где бот админ
const monitoredChannels = new Map(); // channelId -> channelData

// ==================== КОМАНДЫ ====================

bot.start(async (ctx) => {
    const firstName = ctx.from.first_name || 'друг';
    
    await ctx.replyWithHTML(
        `👋 Привет, <b>${firstName}</b>!\n\n` +
        `Я бот <b>NFTG-ZONIX</b> для добавления каналов в навигатор!\n\n` +
        `🎯 <b>Что я умею:</b>\n` +
        `• Собирать статистику канала\n` +
        `• Помочь настроить категории\n` +
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

bot.help(async (ctx) => {
    await showHelp(ctx);
});

// ==================== CALLBACK HANDLERS ====================

// Показать мои каналы
bot.action('show_my_channels', async (ctx) => {
    await ctx.answerCbQuery();
    await showMyChannels(ctx);
});

// Показать помощь
bot.action('show_help', async (ctx) => {
    await ctx.answerCbQuery();
    await showHelp(ctx);
});

// Настроить канал
bot.action(/^setup_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const channelId = ctx.match[1];
    await startChannelSetup(ctx, channelId);
});

// Выбор категории
bot.action(/^category_(.+)_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const categoryName = ctx.match[2];
    
    const session = userSessions.get(ctx.from.id);
    
    if (!session || session.channelId !== channelId) {
        await ctx.answerCbQuery('Сессия устарела, начните заново');
        return;
    }
    
    // Toggle категории
    const index = session.selectedCategories.indexOf(categoryName);
    
    if (index > -1) {
        // Убрать категорию
        session.selectedCategories.splice(index, 1);
        await ctx.answerCbQuery(`✖️ Убрана: ${categoryName}`);
    } else {
        // Добавить категорию
        if (session.selectedCategories.length >= 3) {
            await ctx.answerCbQuery('⚠️ Максимум 3 категории!', { show_alert: true });
            return;
        }
        session.selectedCategories.push(categoryName);
        await ctx.answerCbQuery(`✅ Добавлена: ${categoryName}`);
    }
    
    // Обновить сообщение
    await updateCategorySelection(ctx, channelId);
});

// Подтвердить категории
bot.action(/^confirm_categories_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const channelId = ctx.match[1];
    
    const session = userSessions.get(ctx.from.id);
    
    if (!session || session.selectedCategories.length === 0) {
        await ctx.reply('⚠️ Выберите хотя бы одну категорию!');
        return;
    }
    
    session.step = 'awaiting_description';
    
    await ctx.reply(
        `✅ Категории выбраны:\n` +
        session.selectedCategories.map((c, i) => `${i + 1}. ${c}`).join('\n') +
        `\n\n📝 Теперь напишите описание канала:\n` +
        `(Краткое описание того, о чём ваш канал)`
    );
});

// Опубликовать канал
bot.action(/^publish_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const channelId = ctx.match[1];
    
    const session = userSessions.get(ctx.from.id);
    
    if (!session) {
        await ctx.reply('⚠️ Сессия устарела, начните заново с /my_channels');
        return;
    }
    
    await publishChannel(ctx, channelId);
});

// Отменить настройку
bot.action(/^cancel_setup_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Настройка отменена');
    userSessions.delete(ctx.from.id);
    await ctx.reply('❌ Настройка отменена. Используйте /my_channels для повторной попытки.');
});

// Назад к моим каналам
bot.action('back_to_channels', async (ctx) => {
    await ctx.answerCbQuery();
    await showMyChannels(ctx);
});

// ==================== ОБРАБОТКА ДОБАВЛЕНИЯ/УДАЛЕНИЯ БОТА ====================

bot.on('my_chat_member', async (ctx) => {
    try {
        const update = ctx.update.my_chat_member;
        const chat = update.chat;
        const newStatus = update.new_chat_member.status;
        const oldStatus = update.old_chat_member.status;
        
        console.log(`\n📢 Изменение статуса в канале: ${chat.title}`);
        console.log(`   Старый: ${oldStatus} → Новый: ${newStatus}`);
        
        // Бот стал админом
        if (newStatus === 'administrator') {
            console.log(`✅ Бот добавлен: ${chat.title} (${chat.id})`);
            
            // Получаем статистику
            const stats = await getChannelStats(ctx, chat);
            
            if (stats) {
                monitoredChannels.set(chat.id.toString(), stats);
                
                // Уведомляем владельца
                try {
                    await ctx.telegram.sendMessage(
                        update.from.id,
                        `✅ <b>Канал подключён!</b>\n\n` +
                        `📢 <b>${stats.title}</b>\n` +
                        `👥 Подписчиков: <b>${stats.subscribersCount.toLocaleString()}</b>\n` +
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
        
        // Бот удалён
        if (newStatus === 'left' || newStatus === 'kicked' || newStatus === 'member') {
            console.log(`❌ Бот удалён: ${chat.title} (${chat.id})`);
            
            monitoredChannels.delete(chat.id.toString());
            
            // Удаляем из БД
            await removeChannelFromDB(chat.id);
        }
        
    } catch (error) {
        console.error('❌ Ошибка обработки my_chat_member:', error);
    }
});

// ==================== ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ====================

bot.on('text', async (ctx) => {
    const session = userSessions.get(ctx.from.id);
    
    // Если пользователь в процессе настройки канала
    if (session && session.step === 'awaiting_description') {
        const description = ctx.message.text.trim();
        
        if (description.length < 10) {
            await ctx.reply('⚠️ Описание слишком короткое. Напишите хотя бы 10 символов.');
            return;
        }
        
        if (description.length > 500) {
            await ctx.reply('⚠️ Описание слишком длинное. Максимум 500 символов.');
            return;
        }
        
        session.description = description;
        session.step = 'ready_to_publish';
        
        // Показываем preview
        await showPublishPreview(ctx, session);
    }
});

// ==================== ФУНКЦИИ ====================

// Показать мои каналы
async function showMyChannels(ctx) {
    const userId = ctx.from.id;
    
    // Получаем каналы пользователя
    const userChannels = Array.from(monitoredChannels.values())
        .filter(ch => {
            // TODO: Можно сохранять owner_id при добавлении
            return true; // Пока показываем все
        });
    
    if (userChannels.length === 0) {
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
    
    let message = `📢 <b>Ваши каналы (${userChannels.length}):</b>\n\n`;
    
    const buttons = [];
    
    userChannels.forEach((channel, index) => {
        const status = channel.is_published ? '✅ Опубликован' : '⚪ Не опубликован';
        const subs = channel.subscribersCount.toLocaleString();
        
        message += `${index + 1}. <b>${channel.title}</b>\n`;
        message += `   👥 ${subs} подписчиков\n`;
        message += `   📊 Статус: ${status}\n\n`;
        
        buttons.push([
            Markup.button.callback(
                `⚙️ ${channel.title}`,
                `setup_${channel.channelId}`
            )
        ]);
    });
    
    await ctx.replyWithHTML(
        message,
        Markup.inlineKeyboard(buttons)
    );
}

// Начать настройку канала
async function startChannelSetup(ctx, channelId) {
    const channel = monitoredChannels.get(channelId);
    
    if (!channel) {
        await ctx.reply('⚠️ Канал не найден. Возможно, бот был удалён из админов.');
        return;
    }
    
    // Создаём сессию
    userSessions.set(ctx.from.id, {
        channelId: channelId,
        channelData: channel,
        selectedCategories: [],
        description: null,
        step: 'selecting_categories'
    });
    
    await ctx.replyWithHTML(
        `⚙️ <b>Настройка канала</b>\n\n` +
        `📢 <b>${channel.title}</b>\n` +
        `👥 ${channel.subscribersCount.toLocaleString()} подписчиков\n\n` +
        `Выберите до <b>3 категорий</b> для вашего канала:`,
        await createCategoryKeyboard(channelId, [])
    );
}

// Создать клавиатуру выбора категорий
async function createCategoryKeyboard(channelId, selectedCategories) {
    const buttons = [];
    
    // По 2 кнопки в ряд
    for (let i = 0; i < CATEGORIES.length; i += 2) {
        const row = [];
        
        for (let j = 0; j < 2 && (i + j) < CATEGORIES.length; j++) {
            const cat = CATEGORIES[i + j];
            const isSelected = selectedCategories.includes(cat.name);
            const label = `${isSelected ? '✅' : '⚪'} ${cat.emoji} ${cat.name}`;
            
            row.push(
                Markup.button.callback(
                    label,
                    `category_${channelId}_${cat.name}`
                )
            );
        }
        
        buttons.push(row);
    }
    
    // Кнопка подтверждения
    if (selectedCategories.length > 0) {
        buttons.push([
            Markup.button.callback(
                `✅ Подтвердить (${selectedCategories.length})`,
                `confirm_categories_${channelId}`
            )
        ]);
    }
    
    // Кнопка отмены
    buttons.push([
        Markup.button.callback('❌ Отмена', `cancel_setup_${channelId}`)
    ]);
    
    return Markup.inlineKeyboard(buttons);
}

// Обновить выбор категорий
async function updateCategorySelection(ctx, channelId) {
    const session = userSessions.get(ctx.from.id);
    
    if (!session) return;
    
    try {
        await ctx.editMessageReplyMarkup(
            await createCategoryKeyboard(channelId, session.selectedCategories)
        );
    } catch (e) {
        // Игнорируем ошибки редактирования
    }
}

// Показать preview перед публикацией
async function showPublishPreview(ctx, session) {
    const channel = session.channelData;
    
    let preview = `📋 <b>Предпросмотр публикации</b>\n\n`;
    preview += `📢 <b>${channel.title}</b>\n`;
    preview += `👥 ${channel.subscribersCount.toLocaleString()} подписчиков\n`;
    preview += `🔗 ${channel.username ? '@' + channel.username : 'Приватный канал'}\n\n`;
    preview += `📂 <b>Категории:</b>\n`;
    session.selectedCategories.forEach((cat, i) => {
        const emoji = CATEGORIES.find(c => c.name === cat)?.emoji || '•';
        preview += `   ${emoji} ${cat}\n`;
    });
    preview += `\n📝 <b>Описание:</b>\n${session.description}\n\n`;
    preview += `Всё верно? Публикуем в ZONIX?`;
    
    await ctx.replyWithHTML(
        preview,
        Markup.inlineKeyboard([
            [Markup.button.callback('✅ Опубликовать', `publish_${session.channelId}`)],
            [Markup.button.callback('❌ Отмена', `cancel_setup_${session.channelId}`)]
        ])
    );
}

// Опубликовать канал
async function publishChannel(ctx, channelId) {
    const session = userSessions.get(ctx.from.id);
    
    if (!session) {
        await ctx.reply('⚠️ Сессия устарела');
        return;
    }
    
    const channel = session.channelData;
    
    await ctx.reply('⏳ Публикую канал в ZONIX...');
    
    try {
        // Формируем данные для API
        const channelData = {
            channel_id: channel.channelId,
            title: channel.title,
            username: channel.username,
            description: session.description,
            subscribers_count: channel.subscribersCount,
            photo_url: channel.photoUrl,
            category_1: session.selectedCategories[0] || null,
            category_2: session.selectedCategories[1] || null,
            category_3: session.selectedCategories[2] || null,
            owner_telegram_id: ctx.from.id,
            owner_username: ctx.from.username,
            is_published: true,
            is_verified: true,
            bot_is_admin: true
        };
        
        // Отправляем на сервер
        await sendChannelToAPI(channelData);
        
        // Обновляем локальные данные
        channel.is_published = true;
        monitoredChannels.set(channelId, channel);
        
        // Очищаем сессию
        userSessions.delete(ctx.from.id);
        
        await ctx.replyWithHTML(
            `✅ <b>Канал успешно опубликован в ZONIX!</b>\n\n` +
            `📢 ${channel.title}\n` +
            `👥 ${channel.subscribersCount.toLocaleString()} подписчиков\n\n` +
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

// Получить статистику канала
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
            channelId: chat.id.toString(),
            title: chatInfo.title,
            username: chatInfo.username || null,
            subscribersCount: membersCount,
            photoUrl: photoUrl,
            type: chatInfo.type,
            is_published: false,
            lastUpdate: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        return null;
    }
}

// Отправить канал в API
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

// Удалить канал из БД
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

// Показать помощь
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
        `   • Выберите до 3 категорий\n` +
        `   • Напишите описание\n` +
        `   • Опубликуйте!\n\n` +
        `<b>3. Что дальше:</b>\n` +
        `   • Канал появится в навигаторе ZONIX\n` +
        `   • Статистика обновляется каждые ${UPDATE_INTERVAL / 3600000}ч\n` +
        `   • Пользователи могут оставлять отзывы\n\n` +
        `<b>Команды:</b>\n` +
        `/start - Начало работы\n` +
        `/my_channels - Мои каналы\n` +
        `/help - Эта справка`,
        Markup.inlineKeyboard([
            [Markup.button.callback('📢 Мои каналы', 'show_my_channels')]
        ])
    );
}

// Обновление всех каналов
async function updateAllChannels() {
    console.log(`\n🔄 Автообновление (${monitoredChannels.size} каналов)...`);
    
    for (const [channelId, channelData] of monitoredChannels) {
        try {
            const chat = await bot.telegram.getChat(channelId);
            const stats = await getChannelStats({ telegram: bot.telegram }, chat);
            
            if (stats && channelData.is_published) {
                // Обновляем в БД если канал опубликован
                await sendChannelToAPI({
                    ...channelData,
                    subscribers_count: stats.subscribersCount,
                    title: stats.title
                });
            }
            
            // Пауза между запросами
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.error(`❌ Ошибка обновления ${channelId}:`, error.message);
        }
    }
    
    console.log('✅ Автообновление завершено');
}

// ==================== ЗАПУСК ====================

bot.launch()
    .then(() => {
        console.log('🤖 Интерактивный бот запущен!');
        console.log(`   Username: @${bot.botInfo.username}`);
        console.log(`   API URL: ${API_URL || 'не настроен'}`);
        console.log(`   Автообновление: ${UPDATE_INTERVAL / 3600000}ч`);
        
        // Запускаем автообновление
        setInterval(updateAllChannels, UPDATE_INTERVAL);
        console.log('✅ Автообновление настроено\n');
    })
    .catch(error => {
        console.error('❌ Ошибка запуска бота:', error);
        process.exit(1);
    });

// Graceful shutdown
process.once('SIGINT', () => {
    console.log('\n👋 Остановка бота...');
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    console.log('\n👋 Остановка бота...');
    bot.stop('SIGTERM');
});
