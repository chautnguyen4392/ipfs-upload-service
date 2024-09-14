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
import dotenv from 'dotenv';

let app = express();
const debug = log('ipfs_upload_service');

// CONST USED FOR PRODUCTION
if (process.env.NODE_ENV === 'production') {
  debug('production mode');
  dotenv.config({ path: './.env_prod' });
} else {
  debug('development mode');
  dotenv.config({ path: './.env_dev' });
}

const PORT = Number(process.env.PORT) || 5002;
const FILE_SIZE_LIMIT = Number(process.env.FILE_SIZE_LIMIT) || 5 * 1024 * 1024; // 5MB
const TIMELOCK_DURATION = Number(process.env.TIMELOCK_DURATION) || 21000; // 21000 blocks
const TIMELOCK_AMOUNT = Number(process.env.TIMELOCK_AMOUNT) || 2100; // 2100 YAC
const YASWAP_ENDPOINT = process.env.YASWAP_ENDPOINT || 'https://yaswap.yacoin.org';
const MONGODB = process.env.MONGODB || 'mongodb://admin:admin@127.0.0.1:27017/ipfsuploaddb';

debug('PORT = ', PORT);
debug('FILE_SIZE_LIMIT = ', FILE_SIZE_LIMIT);
debug('TIMELOCK_DURATION = ', TIMELOCK_DURATION);
debug('TIMELOCK_AMOUNT = ', TIMELOCK_AMOUNT);
debug('YASWAP_ENDPOINT = ', YASWAP_ENDPOINT);
debug('MONGODB = ', MONGODB);

// Enable CORS
app.use(
  cors({
    origin: '*',
  })
);

// Format client request logging
app.use(
  logger(
    '[:date[clf]] :remote-addr - :remote-user ":method :url HTTP/:http-version" :status :response-time ms :res[content-length]'
  )
);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

async function isFileExisted(filePath) {
  let isExisted = false;
  const ipfs = create();

  // Get content CID
  const response = await ipfs.add(fs.createReadStream(filePath), { onlyHash: true });
  const cidv0 = response.cid.toString();
  const cidv1 = response.cid.toV1().toString();

  // Check if the content is already existed on our server
  try {
    for await (const { cid, type } of ipfs.pin.ls({ paths: cidv0 })) {
      isExisted = true;
      break;
    }
  } catch (error) {
    isExisted = false;
  }
  return { isExisted, cidv0, cidv1 };
}

async function addFile(filePath) {
  const ipfs = create();

  // Add file
  const response = await ipfs.add(fs.createReadStream(filePath));
  const cidv0 = response.cid.toString();
  const cidv1 = response.cid.toV1().toString();

  return { cidv0, cidv1 };
}

// API to verify timelock transaction and add the IPFS content to our storage
app.post('/api/add_ipfs_content', async (req, res, next) => {
  const form = formidable({ maxFileSize: FILE_SIZE_LIMIT });

  // Get uploaded file from form data
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
    debug('fields = ', util.inspect(fields, { showHidden: false, depth: null, colors: true }));
    debug('files = ', util.inspect(files, { showHidden: false, depth: null, colors: true }));
  } catch (err) {
    // Handle errors
    debug('Failed to parse form with error: ', err);
    const message =
      err.code === formidableErrors.biggerThanTotalMaxFileSize
        ? `The maximum allowable file size is ${FILE_SIZE_LIMIT} bytes. Please upload another file.`
        : String(err);
    res.status(err.httpCode || 400).json({ message });
    return;
  }

  // Check if there is no upload file
  if (!(files.file && files.file.length > 0 && files.file[0].filepath)) {
    const message = `There is no upload file in the payload request.`;
    debug(message);
    res.status(400).json({ message });
    return;
  }
  const filePath = files.file[0].filepath;

  // Check if the content is already existed on our server
  const { isExisted, cidv0: cid0, cidv1: cid1 } = await isFileExisted(filePath);
  if (isExisted) {
    const message = `The upload file ${files.file[0].originalFilename} was already existed on the system.`;
    debug(message);
    res.status(400).json({ message, cid0, cid1 });
    return;
  }

  // Get timelock tx info
  let timelocktx
  if (fields.timelocktx) {
    timelocktx = fields.timelocktx[0];
    debug('timelocktx = ', timelocktx);
  } else {
    const message = `There is no timelock transaction (timelocktx) in the payload request.`;
    debug(message);
    res.status(400).json({ message });
    return
  }

  let txInfo;
  try {
    const { data } = await axios.get(`${YASWAP_ENDPOINT}/ext/gettx/${timelocktx}`);
    txInfo = data;
  } catch (err) {
    const message = `Failed to get info of timelock tx ${timelocktx} with error: ${err.message}. Please contact support on discord.`;
    debug(message);
    res.status(500).json({ message });
    // Remove the uploaded file
    fs.unlink(filePath, (err) => {
      if (err) throw err;
      debug(`${filePath} was deleted`);
    });
    return;
  }
  debug('timelock txInfo = ', util.inspect(txInfo, { showHidden: false, depth: null, colors: true }));

  // Check if the transaction is found
  if (txInfo.error === 'tx not found.') {
    const message = `Can't find timelock transaction ${timelocktx}.`;
    debug(message);
    res.status(400).json({ message });
    // Remove the uploaded file
    fs.unlink(filePath, (err) => {
      if (err) throw err;
      debug(`${filePath} was deleted`);
    });
    return;
  }

  // Verify timelock info
  // Verify if the timelock transaction was already used to upload another IPFS content
  const info = await TimelockInfo.findOne({ tx: timelocktx });
  console.log(
    'get timelock info from database = ',
    util.inspect(info, { showHidden: false, depth: null, colors: true })
  );
  if (info) {
    const message = `Invalid timelock transaction ${timelocktx}. This transaction was already used to upload file having CIDv0 ${info.ipfs_cidv0}.`;
    debug(message);
    res.status(400).json({ message });
    // Remove the uploaded file
    fs.unlink(filePath, (err) => {
      if (err) throw err;
      debug(`${filePath} was deleted`);
    });
    return;
  }

  // Verify if the tx timestamp isn't too old (must be within 1 day) compared to the current timestamp
  const txTimestamp = txInfo.tx.timestamp;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (txTimestamp < currentTimestamp - 24 * 60 * 60) {
    const message = `The timestamp of time-lock YAC tx ${timelocktx} is too old compared to the current timestamp. The timestamp transaction must be within 1 day.`;
    debug(message);
    res.status(400).json({ message });
    // Remove the uploaded file
    fs.unlink(filePath, (err) => {
      if (err) throw err;
      debug(`${filePath} was deleted`);
    });
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
    const message = `Can't find correct timelock UTXO in the transaction ${timelocktx}. The lockup amount must be ${
      TIMELOCK_AMOUNT / 1e6
    } YAC and the lockup period must be ${TIMELOCK_DURATION} blocks.`;
    debug(message);
    res.status(400).json({ message });
    // Remove the uploaded file
    fs.unlink(filePath, (err) => {
      if (err) throw err;
      debug(`${filePath} was deleted`);
    });
    return;
  }

  // Add file
  const { cidv0, cidv1 } = await addFile(filePath);
  const message = `Added ${cidv0} to IPFS storage`;
  debug(message);

  // Add info to database
  const newTimelockInfo = new TimelockInfo({
    tx: timelocktx,
    ipfs_cidv0: cidv0,
    ipfs_cidv1: cidv1,
  });
  await newTimelockInfo.save();

  // Remove the uploaded file
  fs.unlink(filePath, (err) => {
    if (err) throw err;
    debug(`${filePath} was deleted`);
  });
  res.status(200).json({ message, cidv0, cidv1 });
});

// API to check if the content is already existed on our server
app.post('/api/is_content_existed', async (req, res, next) => {
  const form = formidable({ maxFileSize: FILE_SIZE_LIMIT });

  // Get uploaded file from form data
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
    debug('fields = ', util.inspect(fields, { showHidden: false, depth: null, colors: true }));
    debug('files = ', util.inspect(files, { showHidden: false, depth: null, colors: true }));
  } catch (err) {
    // Handle errors
    debug('Failed to parse form with error: ', err);
    const message =
      err.code === formidableErrors.biggerThanTotalMaxFileSize
        ? `The maximum allowable file size is ${FILE_SIZE_LIMIT} bytes. Please upload another file.`
        : String(err);
    res.status(err.httpCode || 400).json({ message });
    return;
  }

  // Check if there is no upload file
  if (!(files.file && files.file.length > 0 && files.file[0].filepath)) {
    const message = `There is no upload file in the payload request.`;
    debug(message);
    res.status(400).json({ message });
    return;
  }
  const filePath = files.file[0].filepath;

  // Check if the content is already existed on our server
  const { isExisted, cidv0, cidv1 } = await isFileExisted(filePath);
  // Remove the uploaded file
  fs.unlink(filePath, (err) => {
    if (err) throw err;
    debug(`${filePath} was deleted`);
  });

  if (isExisted) {
    const message = `The upload file ${files.file[0].originalFilename} was already existed on the system.`;
    debug(message);
    res.status(200).json({ message, cidv0, cidv1 });
  } else {
    const message = `Can't find content on this server.`;
    res.status(404).json({ message, cidv0, cidv1 });
  }
});

// Handle undefined routes (it must be the last route)
app.all('*', (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404;
  err.status = 'Not found';
  res.status(404).json({
    status: err.status,
    message: err.message,
  });
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
mongoose.connect(MONGODB).then(() => {
  console.log('Connected to database %s', MONGODB);
  let server = app.listen(app.get('port'), '::', function () {
    debug('Express server listening on port ' + server.address().port);
  });
});
