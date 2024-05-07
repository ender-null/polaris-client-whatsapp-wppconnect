/* eslint-disable prefer-const */
import WebSocket from 'ws';
import { Bot } from './bot';
import { catchException, logger } from './utils';
import wppconnect from '@wppconnect-team/wppconnect';

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

wppconnect
  .create({
    session: 'polaris',
    catchQR: (base64Qrimg, asciiQR, attempts, urlCode) => {
      console.log('Number of attempts to read the qrcode: ', attempts);
      console.log('Terminal qrcode: ', asciiQR);
      console.log('base64 image string qrcode: ', base64Qrimg);
      console.log('urlCode (data-ref): ', urlCode);
    },
    statusFind: (statusSession, session) => {
      console.log('Status Session: ', statusSession);
      console.log('Session name: ', session);
    },
    headless: true,
    devtools: false,
    useChrome: true,
    debug: false,
    logQR: true,
    browserWS: '',
    browserArgs: [''],
    puppeteerOptions: {},
    disableWelcome: false,
    updatesLog: true,
    autoClose: 60000,
    tokenStore: 'file',
    folderNameToken: './tokens',
  })
  .then((client) => (bot = new Bot(ws, client)))
  .catch((error) => console.log(error));
ws = new WebSocket(process.env.SERVER);

clearInterval(pingInterval);
pingInterval = setInterval(() => {
  bot.ping();
}, 30000);

ws.on('error', async (error: WebSocket.ErrorEvent) => {
  if (error['code'] === 'ECONNREFUSED') {
    logger.info(`Waiting for server to be available...`);
  } else {
    logger.error(error);
  }
});

ws.on('open', async () => {
  //await bot.init()
});

ws.on('close', async (code) => {
  await bot.client.setOnlinePresence(false);

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
