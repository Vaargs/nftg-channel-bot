// start.js - Запуск API и Бота в одном процессе
const { spawn } = require('child_process');

console.log('🚀 Запуск NFTG Channel Bot...\n');

let apiProcess;
let botProcess;

// Запускаем API сервер
function startAPI() {
    console.log('📡 Запуск API сервера...');
    
    apiProcess = spawn('node', ['server.js'], {
        stdio: 'inherit',
        env: process.env
    });
    
    apiProcess.on('error', (err) => {
        console.error('❌ Ошибка API сервера:', err);
        process.exit(1);
    });
    
    apiProcess.on('exit', (code) => {
        console.log(`⚠️ API сервер остановлен с кодом ${code}`);
        if (botProcess) {
            botProcess.kill();
        }
        process.exit(code);
    });
    
    console.log('✅ API сервер запущен\n');
}

// Запускаем бота (через 5 секунд после API)
function startBot() {
    console.log('🤖 Запуск Telegram бота...');
    
    botProcess = spawn('node', ['interactive-bot.js'], {
        stdio: 'inherit',
        env: process.env
    });
    
    botProcess.on('error', (err) => {
        console.error('❌ Ошибка бота:', err);
    });
    
    botProcess.on('exit', (code) => {
        console.log(`⚠️ Бот остановлен с кодом ${code}`);
        if (apiProcess) {
            apiProcess.kill();
        }
        process.exit(code);
    });
    
    console.log('✅ Бот запущен\n');
}

// Запуск
startAPI();

// Ждём 5 секунд чтобы API точно запустился
setTimeout(() => {
    startBot();
}, 5000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n👋 Получен сигнал остановки...');
    if (botProcess) botProcess.kill('SIGTERM');
    if (apiProcess) apiProcess.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1000);
});

process.on('SIGINT', () => {
    console.log('\n👋 Получен сигнал остановки...');
    if (botProcess) botProcess.kill('SIGINT');
    if (apiProcess) apiProcess.kill('SIGINT');
    setTimeout(() => process.exit(0), 1000);
});

console.log('✅ Все процессы запущены');
console.log('📊 Логи будут показаны ниже:\n');
console.log('─────────────────────────────────────\n');
