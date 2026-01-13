/* eslint-disable prefer-const */
import WebSocket from 'ws';
import { Bot } from './bot';
import { catchException, logger } from './utils';
import { Whatsapp, create } from '@wppconnect-team/wppconnect';
import { WSMessage, WSPing } from './types';

let bot: Bot;
let ws: WebSocket;
let pingInterval;

logger.debug(`SERVER: ${process.env.SERVER}`);
logger.debug(`CONFIG: ${process.env.CONFIG}`);
logger.debug(`MONGODB_URI: ${process.env.MONGODB_URI}`);

const close = () => {
  logger.warn(`Close server`);
  ws.terminate();
  process.exit();
};

process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
process.on('exit', () => {
  logger.warn(`Exit process`);
});

create({
  session: 'polaris',
  logger: logger,
  headless: true,
  devtools: false,
  useChrome: false,
  debug: false,
  logQR: true,
  browserWS: '',
  browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--unhandled-rejections=strict'],
  puppeteerOptions: {},
  disableWelcome: true,
  updatesLog: false,
  autoClose: 0,
})
  .then(async (client) => await start(client))
  .catch((error) => logger.error(error.message));
ws = new WebSocket(process.env.SERVER);

clearInterval(pingInterval);
pingInterval = setInterval(() => {
  if (bot) {
    bot.ping();
  } else {
    const data: WSPing = {
      bot: 'unauthenticated',
      platform: 'whatsapp',
      type: 'ping',
    };
    ws.send(JSON.stringify(data, null, 4));
  }
}, 30000);

const start = async (client: Whatsapp) => {
  bot = new Bot(ws, client);
  await bot.init();

  bot.client.onMessage(async (message) => {
    const msg = await bot.convertMessage(message);
    const data: WSMessage = {
      bot: bot.user.username,
      platform: 'whatsapp',
      type: 'message',
      message: msg,
    };
    ws.send(JSON.stringify(data));
  });
};

ws.on('error', async (error: WebSocket.ErrorEvent) => {
  if (error['code'] === 'ECONNREFUSED') {
    logger.info(`Waiting for server to be available...`);
  } else {
    logger.error(error);
  }
});

ws.on('close', async (code) => {
  if (bot) await bot.client.setOnlinePresence(false);

  if (code === 1005) {
    logger.warn(`Disconnected`);
  } else if (code === 1006) {
    logger.warn(`Terminated`);
  }
  clearInterval(pingInterval);
  process.exit();
});

ws.on('message', (data: string) => {
  try {
    const msg = JSON.parse(data);
    if (msg.type !== 'pong') {
      logger.info(JSON.stringify(msg, null, 4));
    }
    if (msg.type === 'message') {
      bot.sendMessage(msg.message);
    }
  } catch (error) {
    catchException(error);
  }
});
