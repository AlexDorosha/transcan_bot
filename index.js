const { Telegraf, session } = require('telegraf');
const { config } = require('./config.js');
const axios = require('axios');
const fs = require('fs');

const bot = new Telegraf(config.telegramToken);

const wallets = {}; // Хранилище кошельков (общая структура для пользователей и групп)

// bot.use((ctx, next) => {
//     console.log(`Chat Type: ${ctx.chat.type}, User ID: ${ctx.from.id}, Chat ID: ${ctx.chat.id}`);
//     return next();
// });
bot.use(session());

// Загрузка сохраненных кошельков (если есть)
if (fs.existsSync('wallets.json')) {
    const data = fs.readFileSync('wallets.json');
    Object.assign(wallets, JSON.parse(data));
}

// Сохранение кошельков в файл
const saveWallets = () => {
    fs.writeFileSync('wallets.json', JSON.stringify(wallets));
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
]);

// /start
bot.start((ctx) => {
    ctx.session = ctx.session || {};
    ctx.reply(
        'Привет! Я бот для отслеживания транзакций.\n' +
        'Команды:\n' +
        '/addwallet - добавить кошелек\n' +
        '/removewallet - удалить кошелек\n' +
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
        chatWallets.map((wallet, index) => `${index + 1}. ${wallet.name}`).join('\n')
    );
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
});

// Функция получения последней транзакции
const getLastTransaction = async (walletAddress) => {
    try {
        const response = await axios.get(
            `https://apilist.tronscanapi.com/api/transfer/trc20?address=${walletAddress}&trc20Id=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&start=0&limit=1`
        );
        return response.data.data?.[0] || null;
    } catch (error) {
        console.error('Ошибка получения транзакции:', error.message);
        return null;
    }
};

// Проверка новых транзакций
const checkForNewTransactions = async () => {
    for (const chatId in wallets) {
        for (const wallet of wallets[chatId]) {
            try {
                const lastTransaction = await getLastTransaction(wallet.address);
                if (
                    lastTransaction &&
                    (!wallet.lastKnownTransaction || wallet.lastKnownTransaction.hash !== lastTransaction.hash)
                ) {
                    wallet.lastKnownTransaction = { hash: lastTransaction.hash };
                    saveWallets();

                    const shortAddress = (address) => `${address.slice(0, 6)}...${address.slice(-6)}`;
                    const isOutgoing = lastTransaction.from === wallet.address;

                    await bot.telegram.sendMessage(
                        chatId,
                        `*Новая транзакция ${wallet.name}:*\n` +
                        `💵 *Сумма:* \`${(lastTransaction.amount / 1e6).toFixed(2)} USDT\`\n` +
                        `👤 *${isOutgoing ? "Получатель" : "Отправитель"}:* \`${shortAddress(
                            isOutgoing ? lastTransaction.to : lastTransaction.from
                        )}\`\n` +
                        `📄 *Тип:* \`${isOutgoing ? "Исходящая" : "Входящая"}\`\n` +
                        `[🔗 Просмотреть транзакцию](https://tronscan.org/#/transaction/${lastTransaction.hash})`,
                        { parse_mode: 'MarkdownV2' }
                    );
                }
            } catch (error) {
                console.error(`Ошибка проверки транзакций для кошелька ${wallet.address}:`, error.message);
            }
        }
    }
};

// Запускаем проверку каждые 30 секунд
setInterval(checkForNewTransactions, 30000);

// Запуск бота
bot.launch();
console.log('Бот запущен.');
