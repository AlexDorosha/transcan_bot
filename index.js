// const { Telegraf } = require('telegraf');
const { Telegraf, session } = require('telegraf');
const { config } = require('./config.js');
const axios = require('axios');
const fs = require('fs');

const bot = new Telegraf(config.telegramToken, {});

const userWallets = {}; // Хранилище для кошельков пользователей
bot.use(session());


// Загрузка сохраненных кошельков (если есть)

if (fs.existsSync('wallets.json')) {
    const data = fs.readFileSync('wallets.json');
    const parsedData = JSON.parse(data);

    // Обход всех ключей и проверка, что каждое значение - это массив
    for (const userId in parsedData) {
        if (!Array.isArray(parsedData[userId])) {
            parsedData[userId] = []; // Замена на пустой массив, если не массив
        }
    }

    Object.assign(userWallets, parsedData);
}
// Сохранение кошельков в файл
const saveWallets = () => {
    fs.writeFileSync('wallets.json', JSON.stringify(userWallets));
};

// Все команды бота
bot.telegram.setMyCommands([
    { command: '/start', description: 'Начальное приветствие' },
    { command: '/listwallets', description: 'Просмотр всех кошельков' },
    { command: '/addwallet', description: 'Добавления кошелька' },
    { command: '/removewallet', description: 'Удаление кошелька' },
]);

// Команда /start
bot.start((ctx) => {
    ctx.session = ctx.session || {}; // Инициализируем сессии, если их еще не было
    ctx.session.state = {}; // Инициализируем состояние при старте
    ctx.reply('Привет! Я бот для отслеживания транзакций.\n' +
        'Используй /addwallet для добавления кошельков.\n' +
        'Используй /removewallet для удаления кошельков.\n' +
        'Используй /listwallets для просмотра кошельков.');;
});

// Команда для добавления кошелька
bot.command('addwallet', (ctx) => {
    ctx.session.state = { action: 'adding_wallet_address' };
    ctx.reply('Введите адрес Вашего кошелька:');
});

// Команда для удаления кошелька
bot.command('removewallet', (ctx) => {
    ctx.session.state = { action: 'removing_wallet_name' };
    ctx.reply('Введите имя кошелька, который хотите удалить (используйте /listwallets для просмотра):');
});

// Команда для просмотра всех добавленных кошельков
bot.command('listwallets', (ctx) => {
    const wallets = userWallets[ctx.from.id];
    if (!wallets || wallets.length === 0) {
        ctx.reply('У вас нет добавленных кошельков.');
    } else {
        ctx.reply(
            'Ваши кошельки:\n' +
            wallets.map((wallet, index) => `${index + 1}. ${wallet.name}`).join('\n')
        );
    }
});

// Обработчик текстовых сообщений
bot.on('text', async (ctx) => {
    ctx.session = ctx.session || {}; // Инициализируем сессии, если их еще не было

    // Обработка добавления кошелька
    if (ctx.session.state && ctx.session.state.action === 'adding_wallet_address') {
        const walletAddress = ctx.message.text.trim();
        ctx.session.newWalletAddress = walletAddress; // Сохраняем адрес для следующего шага
        ctx.session.state.action = 'adding_wallet_name'; // Переходим к следующему шагу
        ctx.reply('Теперь введите имя для этого кошелька:');
    }

    // Обработка имени кошелька
    else if (ctx.session.state && ctx.session.state.action === 'adding_wallet_name') {
        const walletName = ctx.message.text.trim();
        const walletAddress = ctx.session.newWalletAddress;

        if (!userWallets[ctx.from.id]) {
            userWallets[ctx.from.id] = [];
        }

        if (userWallets[ctx.from.id].find(wallet => wallet.name === walletName)) {
            ctx.reply('Этот кошелек с таким именем уже добавлен.');
        } else {
            userWallets[ctx.from.id].push({ name: walletName, address: walletAddress, lastKnownTransaction: null });
            ctx.reply(`Кошелек с адресом ${walletAddress} добавлен под именем "${walletName}"!`);
            saveWallets(); // Сохраняем изменения
        }
        ctx.session.state = null; // Сбрасываем состояние
    }

    // Обработка удаления кошелька
    else if (ctx.session.state && ctx.session.state.action === 'removing_wallet_name') {
        const walletName = ctx.message.text.trim();
        if (!userWallets[ctx.from.id] || userWallets[ctx.from.id].length === 0) {
            ctx.reply('У Вас нет сохраненных кошельков.');
            ctx.session.state = null; // Сбрасываем состояние
            return;
        }

        const walletIndex = userWallets[ctx.from.id].findIndex(wallet => wallet.name === walletName);
        if (walletIndex === -1) {
            ctx.reply('Некорректное имя кошелька. Попробуйте снова.');
        } else {
            const removedWallet = userWallets[ctx.from.id].splice(walletIndex, 1);
            ctx.reply(`Кошелек "${removedWallet[0].name}" удален.`);
            saveWallets(); // Сохраняем изменения
        }
        ctx.session.state = null; // Сбрасываем состояние
    }
});

// Функция для получения последней транзакции
const getLastTransaction = async (walletAddress) => {
    try {
        const response = await axios.get(`https://apilist.tronscanapi.com/api/transfer/trc20?address=${walletAddress}&trc20Id=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&start=0&limit=2&direction=0&reverse=true&db_version=1&start_timestamp=&end_timestamp=`);

        if (response.data.data && response.data.data.length > 0) {
            return response.data.data[0]; // Возвращаем данные первой (последней) транзакции
        } else {
            console.warn(`Нет транзакций для адреса ${walletAddress}.`);
            return null;
        }
    } catch (error) {
        console.error('Ошибка при получении транзакции:', error.message);
        return null;
    }
};

// Функция для отслеживания новых транзакций
const checkForNewTransactions = async () => {
    for (const userId in userWallets) {
        const wallets = userWallets[userId];

        for (const wallet of wallets) {
            try {
                const lastTransaction = await getLastTransaction(wallet.address);

                if (lastTransaction) {
                    if (
                        !wallet.lastKnownTransaction ||
                        wallet.lastKnownTransaction.hash !== lastTransaction.hash
                    ) {
                        wallet.lastKnownTransaction = { hash: lastTransaction.hash };
                        saveWallets();

                        // Отправляем уведомление пользователю
                        await bot.telegram.sendMessage(
                            userId,
                            `Новая транзакция для кошелька ${wallet.name}:\n` +
                            `Сумма: ${lastTransaction.amount / 1e6} USDT\n` +
                            `Отправитель: ${lastTransaction.from}\n` +
                            `Получатель: ${lastTransaction.to}`
                        );
                    }
                }
            } catch (error) {
                console.error(`Ошибка при проверке транзакций для кошелька ${wallet.address}:`, error.message);
            }
        }
    }
};

// Запускаем проверку новых транзакций каждые 1 минут
setInterval(checkForNewTransactions, 1 * 60 * 1000);

// Запуск бота
bot.launch();
console.log('Бот запущен и работает...');





