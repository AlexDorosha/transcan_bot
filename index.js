const { Telegraf, session } = require('telegraf');
const { config } = require('./config.js');
const axios = require('axios');
const fs = require('fs');
const bot = new Telegraf(config.telegramToken);

// Хранилище кошельков (общая структура для пользователей и групп)
const wallets = {};
// Новый список кошельков для проверки
const watchList = [];
// Подгружаем сессии
bot.use(session());

// Загрузка сохраненных кошельков (если есть)
if (fs.existsSync('wallets.json')) {
    const data = fs.readFileSync('wallets.json');
    Object.assign(wallets, JSON.parse(data));
}
// Загрузка списка кошельков для проверки (если есть)
if (fs.existsSync('watchlist.json')) {
    const data = fs.readFileSync('watchlist.json');
    watchList.push(...JSON.parse(data));
}

// Сохранение кошельков в файл
const saveWallets = () => {
    fs.writeFileSync('wallets.json', JSON.stringify(wallets));
};
// Сохранение списка наблюдения в файл
const saveWatchList = () => {
    fs.writeFileSync('watchlist.json', JSON.stringify(watchList));
};

// Функция определения идентификатора для пользователя или группы
const getChatId = (ctx) => {
    if (ctx.chat.type === 'private') {
        return ctx.from.id; // Личный чат
    }
    return ctx.chat.id; // Групповой чат
};

// Команды бота
bot.telegram.setMyCommands([
    { command: '/start', description: 'Начальное приветствие' },
    { command: '/listwallets', description: 'Просмотр всех кошельков' },
    { command: '/addwallet', description: 'Добавление кошелька' },
    { command: '/removewallet', description: 'Удаление кошелька' },
    { command: '/addwatch', description: 'Добавить кошелек партнеров' },
    { command: '/showwatchlist', description: 'Посмотреть кошельки партнеров' },
    { command: '/removewatch', description: 'Удаление кошелька партнеров' },
]);

// /start
bot.start((ctx) => {
    ctx.session = ctx.session || {};
    ctx.reply(
        'Привет! Я бот для отслеживания транзакций.\n' +
        'Команды:\n' +
        '/addwatch - добавить кошелек партнеров\n' +
        '/removewatch - удалить кошелек партнеров\n' +
        '/showwatchlist - список кошельков партнеров\n' +
        '/addwallet - добавить кошелек для отслеживания\n' +
        '/removewallet - удалить кошелек для отслеживания\n' +
        '/listwallets - список кошельков'
    );
});

// /addwallet
bot.command('addwallet', (ctx) => {
    ctx.session.state = { action: 'adding_wallet_address' };
    ctx.reply('Введите адрес кошелька:');
});

// /removewallet
bot.command('removewallet', (ctx) => {
    const chatId = getChatId(ctx);
    if (!wallets[chatId] || wallets[chatId].length === 0) {
        return ctx.reply('Кошельков не найдено.');
    }
    ctx.session.state = { action: 'removing_wallet_name' };
    ctx.reply('Введите имя кошелька, который хотите удалить:');
});

// /listwallets
bot.command('listwallets', (ctx) => {
    const chatId = getChatId(ctx);
    const chatWallets = wallets[chatId] || [];
    if (chatWallets.length === 0) {
        return ctx.reply('Кошельки отсутствуют.');
    }
    ctx.reply(
        'Список кошельков:\n' +
        chatWallets.map((wallet, index) => `${index + 1}. ${wallet.name} (${wallet.address})`).join('\n')
    );
});

// /addwatch       Добавление команды для включения режима добавления кошельков в watchList
bot.command('addwatch', (ctx) => {
    ctx.session.state = { action: 'adding_watchlist_wallet_address' };
    ctx.reply('Введите адрес кошелька для добавления в список наблюдения:');
});


// /showwatchlist    Вывод списка кошельков для проверки
bot.command('showwatchlist', (ctx) => {
    if (watchList.length === 0) {
        ctx.reply('Список кошельков для проверки пуст.');
    } else {
        const listMessage = watchList
            .map((wallet, index) => `${index + 1}. ${wallet.name} (${wallet.address})`)
            .join('\n');
        ctx.reply(`Список кошельков для проверки:\n${listMessage}`);
    }
});


// Функция для поиска имени кошелька по адресу в новом списке
const getWalletNameFromWatchList = (address) => {
    const wallet = watchList.find((w) => w.address === address);
    return wallet ? wallet.name : null;
};


// /removewatch — команда для удаления кошельков из watchList
bot.command('removewatch', (ctx) => {
    if (watchList.length === 0) {
        return ctx.reply('Список кошельков для проверки пуст.');
    }
    ctx.session.state = { action: 'removing_watchlist_wallet_name' };
    ctx.reply('Введите имя кошелька, который хотите удалить из списка для проверки:');
});



// Обработчик текстовых сообщений для добавления и удаления кошельков
bot.on('text', async (ctx) => {
    ctx.session = ctx.session || {};
    const chatId = getChatId(ctx);

    // Проверка прав в группах
    if (ctx.chat.type === 'supergroup' || ctx.chat.type === 'group') {
        const botInfo = await bot.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
        if (!['administrator', 'member'].includes(botInfo.status)) {
            return ctx.reply('У меня нет прав для работы в этой группе.');
        }
    }

    // Добавление кошелька
    if (ctx.session.state?.action === 'adding_wallet_address') {
        ctx.session.newWalletAddress = ctx.message.text.trim();
        ctx.session.state.action = 'adding_wallet_name';
        ctx.reply('Введите имя для кошелька:');
    } else if (ctx.session.state?.action === 'adding_wallet_name') {
        const walletName = ctx.message.text.trim();
        const walletAddress = ctx.session.newWalletAddress;

        wallets[chatId] = wallets[chatId] || [];
        if (wallets[chatId].some((wallet) => wallet.name === walletName)) {
            ctx.reply('Кошелек с таким именем уже существует.');
        } else {
            wallets[chatId].push({ name: walletName, address: walletAddress, lastKnownTransaction: null });
            saveWallets();
            ctx.reply(`Кошелек "${walletName}" добавлен.`);
        }
        ctx.session.state = null;
    }

    // Удаление кошелька
    else if (ctx.session.state?.action === 'removing_wallet_name') {
        const walletName = ctx.message.text.trim();

        if (!wallets[chatId]) {
            ctx.reply('У вас нет добавленных кошельков.');
            return;
        }

        const walletIndex = wallets[chatId].findIndex((wallet) => wallet.name === walletName);
        if (walletIndex === -1) {
            ctx.reply('Кошелек с таким именем не найден.');
        } else {
            const removedWallet = wallets[chatId].splice(walletIndex, 1);
            saveWallets();
            ctx.reply(`Кошелек "${removedWallet[0].name}" удален.`);
        }
        ctx.session.state = null;
    }


    // Добавление кошельков в список для проверки
    if (ctx.session.state?.action === 'adding_watchlist_wallet_address') {
        const walletAddress = ctx.message.text.trim();
        ctx.session.newWatchListWalletAddress = walletAddress;
        ctx.session.state.action = 'adding_watchlist_wallet_name';
        ctx.reply('Введите имя для кошелька:');
    } else if (ctx.session.state?.action === 'adding_watchlist_wallet_name') {
        const walletName = ctx.message.text.trim();
        const walletAddress = ctx.session.newWatchListWalletAddress;

        if (watchList.some((wallet) => wallet.address === walletAddress)) {
            ctx.reply('Кошелек уже добавлен в список для проверки.');
        } else {
            watchList.push({ address: walletAddress, name: walletName });
            saveWatchList();
            ctx.reply(`Кошелек "${walletName}" добавлен в список для проверки.`);
        }
        ctx.session.state = null;
    }


    // Удаление кошелька партнера из watchList
    if (ctx.session.state?.action === 'removing_watchlist_wallet_name') {
        const walletName = ctx.message.text.trim();

        const walletIndex = watchList.findIndex((wallet) => wallet.name === walletName);
        if (walletIndex === -1) {
            ctx.reply('Кошелек с таким именем не найден в списке для проверки.');
        } else {
            const removedWallet = watchList.splice(walletIndex, 1);
            saveWatchList();
            ctx.reply(`Кошелек "${removedWallet[0].name}" удален из списка для проверки.`);
        }
        ctx.session.state = null;
    }
});

// Функция получения транзакций с параметрами (start и limit для пагинации)
const getTransactions = async (walletAddress, start = 0, limit = 10) => {
    try {
        const response = await axios.get(
            `https://apilist.tronscanapi.com/api/transfer/trc20?address=${walletAddress}&trc20Id=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&direction=0&start=${start}&limit=${limit}`
        );
        return response.data.data || [];
    } catch (error) {
        console.error('Ошибка получения транзакций:', error.message);
        return [];
    }
};

// Проверка новых транзакций
const checkForNewTransactions = async () => {
    for (const chatId in wallets) {
        for (const wallet of wallets[chatId]) {
            try {
                let start = 0;
                const limit = 10;
                const newTransactions = [];
                const minAmount = 10 * 1e6;

                while (true) {
                    // Получаем список транзакций с пагинацией
                    const transactions = await getTransactions(wallet.address, start, limit);

                    // Если транзакции закончились, выходим из цикла
                    if (!transactions.length) break;

                    for (const transaction of transactions) {
                        // Пропускаем транзакцию, если её сумма меньше минимальной
                        if (transaction.amount < minAmount) continue;

                        // Если нашли последнюю обработанную транзакцию, прекращаем сканирование
                        if (wallet.lastKnownTransaction?.hash === transaction.hash) {
                            // Выходим из цикла for, а затем из while
                            transactions.length = 0; // Очищаем список, чтобы выйти из while
                            break;
                        }

                        // Добавляем транзакцию в список новых
                        newTransactions.push(transaction);
                    }

                    // Увеличиваем старт для следующей порции транзакций
                    start += limit;
                }

                // Обрабатываем новые транзакции (в обратном порядке, от старых к новым)
                newTransactions.reverse();

                for (const transaction of newTransactions) {
                    // Определяем тип транзакции
                    const isOutgoing = transaction.from === wallet.address;
                    const otherParty = isOutgoing ? transaction.to : transaction.from;

                    // Сохраняем последнюю транзакцию
                    wallet.lastKnownTransaction = { hash: transaction.hash };
                    saveWallets();

                    // Проверяем наличие адреса в списке наблюдений
                    const otherPartyName = getWalletNameFromWatchList(otherParty);
                    const shortAddress = (address) => `${address.slice(0, 6)}...${address.slice(-6)}`;

                    // Формируем сообщение
                    const transactionMessage =
                        `*Новая транзакция ${wallet.name}:*\n` +
                        `💵 *Сумма:* \`${(transaction.amount / 1e6).toFixed(2)} USDT\`\n` +
                        `👤 *${isOutgoing ? "Получатель" : "Отправитель"}:* \`${otherPartyName || shortAddress(otherParty)}\` \n` +
                        `📄 *Тип:* \`${isOutgoing ? "Отправка" : "Пополнение"}\`\n` +
                        ` [🔗 Просмотреть транзакцию](https://tronscan.org/#/transaction/${transaction.hash})`;

                    // Отправляем сообщение
                    await bot.telegram.sendMessage(chatId, transactionMessage, {
                        parse_mode: 'MarkdownV2',
                    });
                }
            } catch (error) {
                console.error(`Ошибка проверки транзакций для кошелька ${wallet.address}:`, error.message);
            }
        }
    }
};


// Запускаем проверку каждую секунду
setInterval(checkForNewTransactions, 3000);

// Запуск бота
bot.launch();
console.log('Бот запущен.');
