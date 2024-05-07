/* eslint-disable @typescript-eslint/no-explicit-any */
import WebSocket from 'ws';
import { FileResult } from 'tmp';
import { Conversation, Extra, Message, User, WSInit, WSPing } from './types';
import { Config } from './config';
import { fromBase64, htmlToWhatsAppMarkdown, logger } from './utils';
import { Whatsapp, Message as WAMessage, MessageType } from '@wppconnect-team/wppconnect';

export class Bot {
  user: User;
  websocket: WebSocket;
  client: Whatsapp;

  constructor(websocket: WebSocket, client: Whatsapp) {
    this.websocket = websocket;
    this.client = client;
  }

  async init() {
    const me = await this.client.getWid();
    this.user = {
      id: me,
      firstName: me,
      lastName: null,
      username: me,
      isBot: false,
    };
    const config: Config = JSON.parse(process.env.CONFIG);
    const data: WSInit = {
      bot: this.user.username,
      platform: 'whatsapp',
      type: 'init',
      user: this.user,
      config,
    };
    await this.client.setOnlinePresence(true);
    this.websocket.send(JSON.stringify(data, null, 4));
    logger.info(`Connected as @${data.user.username}`);
  }

  ping() {
    logger.debug('ping');
    if (this.user) {
      const data: WSPing = {
        bot: this.user.username,
        platform: 'whatsapp',
        type: 'ping',
      };
      this.websocket.send(JSON.stringify(data, null, 4));
    }
  }

  async convertMessage(msg: WAMessage) {
    await this.client.setOnlinePresence(true);
    await this.client.sendSeen(msg.chatId);
    const id: string = msg.id;
    const extra: Extra = {
      // originalMessage: msg,
    };
    const chat = await this.client.getChatById(msg.chatId);
    const conversation = msg.isGroupMsg
      ? new Conversation(`-${chat.id}`, chat.name)
      : new Conversation(msg.sender.id.user, msg.sender.name);
    const sender = new User(msg.sender.id.user, msg.sender.name, null, msg.sender.id.user, false);
    let content;
    let type;

    if (msg.type === MessageType.CIPHERTEXT) {
      content = msg.body;
      type = 'text';
      if (msg.mentionedJidList) {
        extra.mentions = msg.mentionedJidList;
      }
    } else {
      type = 'unsupported';
    }
    let reply: Message = null;
    if (msg.quotedMsgId) {
      const quotedMsg = await this.client.getMessageById(msg.quotedMsgId);
      reply = await this.convertMessage(quotedMsg);
    }

    const date = msg.timestamp;
    return new Message(id, conversation, sender, content, type, date, reply, extra);
  }

  formatChatId(conversationId: number | string) {
    return String(conversationId).startsWith('-')
      ? `${String(conversationId).slice(1)}@g.us`
      : `${conversationId}@c.us`;
  }

  async sendMessage(msg: Message): Promise<WAMessage> {
    await this.client.setOnlinePresence(true);
    const chatId = this.formatChatId(msg.conversation.id);
    await this.client.startTyping(chatId);

    let caption = msg.extra?.caption;
    if (msg.extra && msg.extra.format && msg.extra.format === 'HTML') {
      caption = htmlToWhatsAppMarkdown(msg.extra?.caption);
    }
    caption = caption?.trim();
    const quotedMessageId = msg.reply ? String(msg.reply.id) : null;

    if (msg.type == 'text') {
      if (!msg.content || (typeof msg.content == 'string' && msg.content.length == 0)) {
        return null;
      }
      let preview = false;
      if (msg.extra && 'preview' in msg.extra) {
        preview = msg.extra.preview;
      }
      let text = msg.content;
      if (msg.extra && msg.extra.format && msg.extra.format === 'HTML') {
        text = htmlToWhatsAppMarkdown(text);
      }
      text = text.trim();
      const result = text.matchAll(/@\d+/gim);
      const mentionsFound = [...result][0];
      const mentions: any[] = mentionsFound?.map((mention) => `${mention.slice(1)}@c.us`);
      this.client.sendText(chatId, text, {
        linkPreview: preview,
        mentionedList: mentions,
        quotedMsg: quotedMessageId,
      });
    } else if (msg.type == 'photo') {
      this.client.sendImageFromBase64(chatId, msg.content, msg.type, msg.extra.caption, quotedMessageId);
    } else if (msg.type == 'animation') {
      this.client.sendGifFromBase64(chatId, msg.content, msg.type, msg.extra.caption);
    } else if (msg.type == 'voice' || msg.type == 'audio') {
      this.client.sendPttFromBase64(chatId, msg.content, msg.type, msg.extra.caption,quotedMessageId);
    } else if (msg.type == 'document') {
      this.client.sendFile(chatId, msg.content, msg.type, msg.extra.caption);
    } else if (msg.type == 'video') {
      this.client.sendVideoAsGifFromBase64(chatId, msg.content, msg.type, msg.extra.caption, quotedMessageId);
    }
    await this.client.stopTyping(chatId);
    return null;
  }

  async getInputFile(content: string): Promise<string> {
    if (content.startsWith('/')) {
      const file: FileResult = await fromBase64(content);
      return file.name;
    }
    return null;
  }
}
