const { Telegraf, session } = require('telegraf');
const { config } = require('./config.js');
const axios = require('axios');
const fs = require('fs');
const bot = new Telegraf(config.telegramToken);

// Хранилище кошельков (общая структура для пользователей и групп)
const wallets = {};
// Новый список кошельков для проверки
const watchList = [];
// Новый список кошельков для баланса
const balanceWallets = {};

// Настройка сессии с дефолтными значениями
bot.use(session());

// Теперь устанавливаем начальное состояние при создании сессии
bot.use((ctx, next) => {
    // Инициализируем сессию если её нет
    if (!ctx.session) {
        ctx.session = {
            state: null,
            newWalletAddress: null,
            newWatchListWalletAddress: null,
            newBalanceWalletAddress: null
        };
    }
    return next();
});

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
// загрукза списка кошельков БАЛАНСА
if (fs.existsSync('balanceWallets.json')) {
    Object.assign(balanceWallets, JSON.parse(fs.readFileSync('balanceWallets.json')));
}
//сохранение кошелька БАЛАНСА
const saveBalanceWallets = () => {
    fs.writeFileSync('balanceWallets.json', JSON.stringify(balanceWallets));
};

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
    { command: '/addbalancewallet', description: 'добавление кошелька БАЛАНСА' },
    { command: '/removebalancewallet', description: 'Удаление кошелька БАЛАНСА' },
    { command: '/listbalancewallets', description: 'список кошелька БАЛАНСА' },
    { command: '/getbalance', description: 'получить БАЛАНС' },
]);

// /start
bot.start((ctx) => {
    // Убедимся что сессия существует
    if (!ctx.session) ctx.session = {};
    
    ctx.reply(
        'Привет! Я бот для отслеживания транзакций.\n' +
        'Команды:\n' +
        '/addwatch - добавить кошелек партнеров\n' +
        '/removewatch - удалить кошелек партнеров\n' +
        '/showwatchlist - список кошельков партнеров\n' +
        '/addbalancewallet - добавить кошелек для баланса\n' +
        '/removebalancewallet - удалить кошелек для баланса\n' +
        '/listbalancewallets - список кошельков для баланса\n' +
        '/getbalance - получить баланс\n' +
        '/addwallet - добавить кошелек для отслеживания\n' +
        '/removewallet - удалить кошелек для отслеживания\n' +
        '/listwallets - список кошельков'
    );
});

// /addwallet
bot.command('addwallet', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = { action: 'adding_wallet_address' };
    ctx.reply('Введите адрес кошелька:');
});

// /addbalancewallet
bot.command('addbalancewallet', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = { action: 'adding_balance_wallet_address' };
    ctx.reply('Введите адрес кошелька для получения баланса:');
});

// /removebalancewallet
bot.command('removebalancewallet', (ctx) => {
    if (!ctx.session) ctx.session = {};
    const chatId = getChatId(ctx);
    if (!balanceWallets[chatId] || balanceWallets[chatId].length === 0) {
        return ctx.reply('Список кошельков для баланса пуст.');
    }
    ctx.session.state = { action: 'removing_balance_wallet_name' };
    ctx.reply('Введите имя кошелька, который хотите удалить:');
});

// /listbalancewallets
bot.command('listbalancewallets', (ctx) => {
    const chatId = getChatId(ctx);
    const chatWallets = balanceWallets[chatId] || [];
    if (chatWallets.length === 0) {
        return ctx.reply('Список кошельков для баланса пуст.');
    }
    ctx.reply(
        'Список кошельков для баланса:\n' +
        chatWallets.map((wallet, index) => `${index + 1}. ${wallet.name} (${wallet.address})`).join('\n')
    );
});

// /removewallet
bot.command('removewallet', (ctx) => {
    if (!ctx.session) ctx.session = {};
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

// /addwatch
bot.command('addwatch', (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.state = { action: 'adding_watchlist_wallet_address' };
    ctx.reply('Введите адрес кошелька для добавления в список наблюдения:');
});

// /showwatchlist
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

// /removewatch
bot.command('removewatch', (ctx) => {
    if (!ctx.session) ctx.session = {};
    if (watchList.length === 0) {
        return ctx.reply('Список кошельков для проверки пуст.');
    }
    ctx.session.state = { action: 'removing_watchlist_wallet_name' };
    ctx.reply('Введите имя кошелька, который хотите удалить из списка для проверки:');
});

// Кнопка баланса 
bot.command('getbalance', async (ctx) => {
    const chatId = getChatId(ctx);
    const chatWallets = balanceWallets[chatId] || [];

    if (chatWallets.length === 0) {
        return ctx.reply('Нет кошельков для запроса баланса.');
    }

    let totalBalance = 0;
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    for (const wallet of chatWallets) {
        let retries = 3; // Количество попыток запроса баланса
        while (retries > 0) {
            try {
                const response = await axios.get(`https://apilist.tronscanapi.com/api/account?address=${wallet.address}`);
                const usdtBalance = response.data.trc20token_balances?.find(token => token.tokenAbbr === 'USDT');

                if (usdtBalance) {
                    const balance = parseInt(usdtBalance.balance) / Math.pow(10, usdtBalance.tokenDecimal);
                    totalBalance += balance;
                }
                await delay(4000); // Увеличиваем задержку до 4 секунд между запросами
                break; // Если запрос успешен, выходим из цикла ретраев
            } catch (error) {
                retries--;
                console.error(`Ошибка получения баланса для ${wallet.address}:`, error.response?.data || error.message);
                if (error.response?.data?.Error?.includes('request rate exceeded')) {
                    console.log('Превышен лимит запросов, ждем 5 секунд...');
                    await delay(5000); // Ждем 5 секунд перед новой попыткой
                } else {
                    break; // Если ошибка не связана с лимитом, не повторяем запрос
                }
            }
        }
    }

    ctx.reply(`Общий баланс по всем кошелькам: ${totalBalance.toFixed(2)} USDT`);
});

// Обработчик текстовых сообщений для добавления и удаления кошельков
bot.on('text', async (ctx) => {
    // Убедимся, что сессия существует
    if (!ctx.session) ctx.session = {};
    const chatId = getChatId(ctx);

    // Проверка прав в группах
    if (ctx.chat.type === 'supergroup' || ctx.chat.type === 'group') {
        try {
            const botInfo = await bot.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
            if (!['administrator', 'member'].includes(botInfo.status)) {
                return ctx.reply('У меня нет прав для работы в этой группе.');
            }
        } catch (error) {
            console.error('Ошибка при проверке прав бота:', error);
            return ctx.reply('Не удалось проверить права бота в группе.');
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
            try {
                // Получаем последнюю транзакцию
                const transactions = await getTransactions(walletAddress, 0, 1); // Берем 1 последнюю транзакцию
                const lastTransaction = transactions.length > 0 ? transactions[0] : null;

                // Добавляем кошелек с последней транзакцией
                wallets[chatId].push({
                    name: walletName,
                    address: walletAddress,
                    lastKnownTransaction: lastTransaction ? { hash: lastTransaction.hash } : null,
                    justAdded: true,
                });

                saveWallets();
                ctx.reply(`Кошелек "${walletName}" добавлен и начнет отслеживаться.`);
            } catch (error) {
                console.error('Ошибка при добавлении кошелька:', error);
                ctx.reply('Произошла ошибка при добавлении кошелька. Пожалуйста, попробуйте снова позже.');
            }
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
    else if (ctx.session.state?.action === 'adding_watchlist_wallet_address') {
        ctx.session.newWatchListWalletAddress = ctx.message.text.trim();
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
    else if (ctx.session.state?.action === 'removing_watchlist_wallet_name') {
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
    
    // Добавление кошельков в список балансов
    else if (ctx.session.state?.action === 'adding_balance_wallet_address') {
        ctx.session.newBalanceWalletAddress = ctx.message.text.trim();
        ctx.session.state.action = 'adding_balance_wallet_name';
        ctx.reply('Введите имя для кошелька:');
    } else if (ctx.session.state?.action === 'adding_balance_wallet_name') {
        const walletName = ctx.message.text.trim();
        const walletAddress = ctx.session.newBalanceWalletAddress;

        balanceWallets[chatId] = balanceWallets[chatId] || [];
        if (balanceWallets[chatId].some((wallet) => wallet.name === walletName)) {
            ctx.reply('Кошелек с таким именем уже существует в списке балансов.');
        } else {
            balanceWallets[chatId].push({ name: walletName, address: walletAddress });
            saveBalanceWallets();
            ctx.reply(`Кошелек "${walletName}" добавлен в список балансов.`);
        }
        ctx.session.state = null;
    }
    
    // Удаление кошелька из списка балансов
    else if (ctx.session.state?.action === 'removing_balance_wallet_name') {
        const walletName = ctx.message.text.trim();

        if (!balanceWallets[chatId] || balanceWallets[chatId].length === 0) {
            ctx.reply('Список кошельков для баланса пуст.');
            return;
        }

        const walletIndex = balanceWallets[chatId].findIndex((wallet) => wallet.name === walletName);
        if (walletIndex === -1) {
            ctx.reply('Кошелек с таким именем не найден в списке балансов.');
        } else {
            const removedWallet = balanceWallets[chatId].splice(walletIndex, 1);
            saveBalanceWallets();
            ctx.reply(`Кошелек "${removedWallet[0].name}" удален из списка балансов.`);
        }
        ctx.session.state = null;
    }
});

// Функция получения транзакций с параметрами (start и limit для пагинации)
const delay = (ms) => new Promise(res => setTimeout(res, ms));
const getTransactions = async (walletAddress, start = 0, limit = 10) => {
    await delay(5000); // Увеличиваем задержку до 5 секунд
    try {
        const response = await axios.get(
            `https://apilist.tronscanapi.com/api/transfer/trc20?address=${walletAddress}&trc20Id=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&direction=0&start=${start}&limit=${limit}`,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://tronscan.org/',
                    'Origin': 'https://tronscan.org'
                }
            }
        );
        return response.data.data || [];
    } catch (error) {
        if (error.response && error.response.status === 403) {
            console.error('Ошибка доступа 403. Ожидание 60 секунд перед следующей попыткой.');
            await delay(60000); // Ждем минуту при 403 ошибке
            return [];
        }
        console.error('Ошибка получения транзакций:', error.message);
        return [];
    }
};

// Проверка новых транзакций
const checkForNewTransactions = async () => {
    try {
        for (const chatId in wallets) {
            for (const wallet of wallets[chatId]) {
                try {
                    let start = 0;
                    const limit = 10;
                    const newTransactions = [];
                    const minAmount = 10 * 1e6;
                    let lastTransactionFound = false;

                    while (!lastTransactionFound) {
                        // Получаем список транзакций с пагинацией
                        const transactions = await getTransactions(wallet.address, start, limit);

                        // Если транзакции закончились, выходим из цикла
                        if (!transactions.length) break;

                        for (const transaction of transactions) {
                            // Пропускаем транзакцию, если её сумма меньше минимальной
                            if (transaction.amount < minAmount) continue;

                            // Если нашли последнюю обработанную транзакцию, прекращаем сканирование
                            if (wallet.lastKnownTransaction?.hash === transaction.hash) {
                                lastTransactionFound = true;
                                break; // Прерываем цикл for
                            }

                            // Добавляем транзакцию в список новых
                            newTransactions.push(transaction);
                        }

                        // Увеличиваем старт для следующей порции транзакций
                        start += limit;
                    }

                    // Обрабатываем новые транзакции (в обратном порядке, от старых к новым)
                    newTransactions.reverse();

                    if (wallet.justAdded) {
                        // Кошелёк только добавили, фиксируем последнюю транзакцию и пропускаем
                        if (newTransactions.length > 0) {
                            wallet.lastKnownTransaction = { hash: newTransactions[newTransactions.length - 1].hash };
                            saveWallets();
                        }
                        wallet.justAdded = false; // Теперь кошелек работает в нормальном режиме
                        continue; // Пропускаем отправку старых транзакций
                    }

                    for (const transaction of newTransactions) {
                        // Определяем тип транзакции
                        const isOutgoing = transaction.from === wallet.address;
                        const otherParty = isOutgoing ? transaction.to : transaction.from;

                        // Сохраняем последнюю обработанную транзакцию (самую новую)
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

                        try {
                            // Отправляем сообщение
                            await bot.telegram.sendMessage(chatId, transactionMessage, {
                                parse_mode: 'MarkdownV2',
                                disable_web_page_preview: true
                            });
                        } catch (error) {
                            console.error(`Ошибка отправки сообщения для чата ${chatId}:`, error.message);
                        }
                    }
                } catch (error) {
                    console.error(`Ошибка проверки транзакций для кошелька ${wallet.address}:`, error.message);
                    await delay(10000); // Пауза перед проверкой следующего кошелька при ошибке
                }
                // Добавляем задержку между проверками разных кошельков
                await delay(3000);
            }
        }
    } catch (error) {
        console.error('Глобальная ошибка при проверке транзакций:', error);
    }
};

// Увеличиваем интервал проверки до 1 минуты
setInterval(checkForNewTransactions, 60000);

// Обработчик ошибок
bot.catch((err, ctx) => {
    console.error(`Ошибка при обработке update ${ctx.updateType}:`, err);
    // Отправляем сообщение об ошибке пользователю (если возможно)
    try {
        ctx.reply('Произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте снова позже.');
    } catch (e) {
        console.error('Не удалось отправить сообщение об ошибке пользователю:', e);
    }
});

// Запуск бота
bot.launch().then(() => {
    console.log('Бот запущен.');
}).catch(err => {
    console.error('Ошибка при запуске бота:', err);
});

// Включаем корректное завершение работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
