import axios from 'axios';
import express from 'express';
import logger from 'morgan';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import log from 'debug';
import cors from 'cors';
import formidable, { errors as formidableErrors } from 'formidable';
import { create } from 'kubo-rpc-client';
import * as fs from 'node:fs';
import util from 'util';
import mongoose from 'mongoose';
import { TimelockInfo } from './models/timelockInfo.js';

// CONST USED FOR PRODUCTION
const PORT = 5002;
const FILE_SIZE_LIMIT = 5 * 1024 * 1024;
// const TIMELOCK_DURATION = 21000; // 21000 blocks
// const TIMELOCK_AMOUNT = 2100 * 1e6; // 2100 YAC
// const YASWAP_ENDPOINT = 'https://yaswap.yacoin.org';
const dbSettings = {
  user: 'admin',
  password: 'admin',
  database: 'ipfsuploaddb',
  address: '127.0.0.1',
  port: 27017,
};
var dbString = 'mongodb://' + dbSettings.user;
dbString = dbString + ':' + dbSettings.password;
dbString = dbString + '@' + dbSettings.address;
dbString = dbString + ':' + dbSettings.port;
dbString = dbString + '/' + dbSettings.database;

// CONST USED FOR TESTING
const TIMELOCK_DURATION = 20; // 20 blocks
const TIMELOCK_AMOUNT = 10 * 1e6; // 10 YAC
const YASWAP_ENDPOINT = 'http://192.168.0.103:3001';

var app = express();
const debug = log('ipfs_handler');

app.use(
  cors({
    origin: '*',
  })
);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

async function isFileExisted(filePath) {
  let isExisted = false;
  const ipfs = create();

  // Get content CID
  debug('TACA ===> isFileExisted, filePath = ', filePath);
  const response = await ipfs.add(fs.createReadStream(filePath), { onlyHash: true });
  debug('TACA ===> isFileExisted, response = ', response);
  const cidv0 = response.cid.toString();
  const cidv1 = response.cid.toV1().toString();
  debug('TACA ===> isFileExisted, cidv0 = ', cidv0);
  debug('TACA ===> isFileExisted, cidv1 = ', cidv1);

  // Check if the content is already existed on our server
  try {
    for await (const { cid, type } of ipfs.pin.ls({ paths: cidv0 })) {
      debug('TACA ===> isFileExisted, cid = ', cid, ', type = ', type);
      isExisted = true;
      break;
    }
  } catch (error) {
    debug('TACA ===> isFileExisted, error = ', error);
    isExisted = false;
  }
  return isExisted;
}

async function addFile(filePath) {
  const ipfs = create();

  // Add file
  debug('TACA ===> addFile, filePath = ', filePath);
  const response = await ipfs.add(fs.createReadStream(filePath));
  debug('TACA ===> addFile, response = ', response);
  const cidv0 = response.cid.toString();
  const cidv1 = response.cid.toV1().toString();
  debug('TACA ===> addFile, cidv0 = ', cidv0);
  debug('TACA ===> addFile, cidv1 = ', cidv1);

  return { cidv0, cidv1 };
}

// API to verify timelock transaction and add the IPFS content to our storage
app.post('/api/add_ipfs_content', async (req, res, next) => {
  debug('TACA ===> /api/add_ipfs_content, Receive request req = ', req);
  const form = formidable({ maxFileSize: FILE_SIZE_LIMIT });

  // Get uploaded file from form data
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
    debug('TACA ===> POST request /api/add_ipfs_content, fields = ', fields, ', files = ', files);
  } catch (err) {
    // Handle errors
    debug('Failed to parse form with error: ', err);
    res.writeHead(err.httpCode || 400, { 'Content-Type': 'text/plain' });
    if (err.code === formidableErrors.biggerThanTotalMaxFileSize) {
      res.end(`The maximum allowable file size is ${FILE_SIZE_LIMIT} bytes. Please upload another file.`);
    } else {
      res.end(String(err));
    }
    return;
  }

  // Check if the content is already existed on our server
  const isExisted = await isFileExisted(files.file[0].filepath);
  if (isExisted) {
    const error = `The upload file ${files.file[0].originalFilename} was already existed on the system. Please upload another file.`;
    debug(error);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(error);
    return;
  }

  // Get timelock tx info
  const timelocktx = fields.timelocktx[0];
  debug('TACA ===> /api/add_ipfs_content, timelocktx = ', timelocktx);

  let txInfo;
  try {
    const { data } = await axios.get(`${YASWAP_ENDPOINT}/ext/gettx/${timelocktx}`);
    txInfo = data;
  } catch (err) {
    const error = `Failed to get info of timelock tx ${timelocktx} with error: ${err.message}. Please contact support on discord.`;
    debug(error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(error);
    return;
  }
  debug(
    'TACA ===> /api/add_ipfs_content, txInfo = ',
    util.inspect(txInfo, { showHidden: false, depth: null, colors: true })
  );

  // Verify timelock info
  // Verify if the timelock transaction was already used to upload another IPFS content
  const info = await TimelockInfo.findOne({ tx: timelocktx });
  console.log('TACA ===> timelock info = ', util.inspect(info, { showHidden: false, depth: null, colors: true }));
  if (info) {
    const error = `Invalid timelock transaction ${timelocktx}. This transaction was already used to upload file having CIDv0 ${info.ipfs_cidv0}.`;
    debug(error);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(error);
    return;
  }

  // Verify if the tx timestamp isn't too old (must be within 1 day) compared to the current timestamp
  const txTimestamp = txInfo.tx.timestamp;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (txTimestamp < currentTimestamp - 24 * 60 * 60) {
    const error = `The timestamp of time-lock YAC tx ${timelocktx} is too old compared to the current timestamp. The timestamp transaction must be within 1 day.`;
    debug(error);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(error);
    return;
  }

  // Verify lockup amount and lockup period
  let hasTimelockUTXO = false;
  for (const vout of txInfo.tx.vout) {
    if (vout.amount === TIMELOCK_AMOUNT && vout.timelockUtxoInfo?.locktime === TIMELOCK_DURATION) {
      hasTimelockUTXO = true;
      break;
    }
  }

  if (!hasTimelockUTXO) {
    const error = `Can't find correct timelock UTXO in the transaction ${timelocktx}. The lockup amount must be ${
      TIMELOCK_AMOUNT / 1e6
    } YAC and the lockup period must be ${TIMELOCK_DURATION} blocks.`;
    debug(error);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(error);
    return;
  }

  // Add file
  const { cidv0, cidv1 } = await addFile(files.file[0].filepath);

  // Add info to datbase
  const newTimelockInfo = new TimelockInfo({
    tx: timelocktx,
    ipfs_cidv0: cidv0,
    ipfs_cidv1: cidv1,
  });
  await newTimelockInfo.save();

  res.json({ cidv0, cidv1 });
});

// API to check if the content is already existed on our server
app.post('/api/is_content_existed', async (req, res, next) => {
  debug('TACA ===> /api/is_content_existed, Receive request req = ', req);
  const form = formidable({ maxFileSize: FILE_SIZE_LIMIT });

  // Get uploaded file from form data
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
    debug('TACA ===> POST request /api/is_content_existed, fields = ', fields, ', files = ', files);
  } catch (err) {
    // Handle errors
    debug('Failed to parse form with error: ', err);
    res.writeHead(err.httpCode || 400, { 'Content-Type': 'text/plain' });
    if (err.code === formidableErrors.biggerThanTotalMaxFileSize) {
      res.end(`The maximum allowable file size is ${FILE_SIZE_LIMIT} bytes. Please upload another file.`);
    } else {
      res.end(String(err));
    }
    return;
  }

  // Check if the content is already existed on our server
  const isExisted = await isFileExisted(files.file[0].filepath);
  debug('TACA ===> POST request /api/is_content_existed, isExisted = ', isExisted);
  res.json({ status: isExisted });
});

// Handle undefined routes (it must be the last route)
app.all('*', (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404;
  err.status = 'fail';
  next(err);
});

// Global error handling middleware
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
  });
});

process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.log(err.name, err.message);
  process.exit(1);
});

app.set('port', PORT);

// Initialize database and server
mongoose.connect(dbString).then(() => {
  console.log('Connected to database %s', dbString);
  var server = app.listen(app.get('port'), '::', function () {
    debug('Express server listening on port ' + server.address().port);
  });
});
