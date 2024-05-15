import express from 'express';
import logger from 'morgan';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import log from 'debug';
import cors from 'cors';
import formidable, { errors as formidableErrors } from 'formidable';
import { create } from 'kubo-rpc-client';
import * as fs from 'node:fs';

var app = express();

const debug = log('ipfs_handler');
const PORT = 3000;
const FILE_SIZE_LIMIT = 5 * 1024 * 1024;

app.use(
  cors({
    origin: '*',
  })
);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// API to verify timelock transaction and add the IPFS content to our storage
app.post('/api/ipfsdata', (req, res, next) => {
  debug('TACA ===> /api/ipfsdata, Receive request req = ', req);
  const form = formidable({});
  const tx = req.body.timelocktx;
  debug('TACA ===> /api/ipfsdata, req.body = ', req.body);
  debug('TACA ===> /api/ipfsdata, formData = ', formData);
  debug('TACA ===> /api/ipfsdata, tx = ', tx);

  debug('TACA ===> /api/ipfsdata, Create form = ', form);
  form.parse(req, (err, fields, files) => {
    debug('POST request /api/ipfsdata, err = ', err, ', fields = ', fields, ', files = ', files);
    if (err) {
      next(err);
      return;
    }
    res.json({ fields, files });
  });
});

// API to check if the content is already existed on our server
app.post('/api/is_content_existed', async (req, res, next) => {
  debug('TACA ===> /api/is_content_existed, Receive request req = ', req);
  const form = formidable({ maxFileSize: FILE_SIZE_LIMIT });

  debug('TACA ===> /api/is_content_existed, Create form = ', form);

  let fields, files;
  try {
    [fields, files] = await form.parse(req);
    debug('TACA ===> POST request /api/is_content_existed, fields = ', fields, ', files = ', files);
  } catch (err) {
    // Handle errors
    console.error('Failed to parse form with error: ', err);
    res.writeHead(err.httpCode || 400, { 'Content-Type': 'text/plain' });
    if (err.code === formidableErrors.biggerThanTotalMaxFileSize) {
      res.end(`The maximum allowable file size is ${FILE_SIZE_LIMIT} bytes. Please upload another file.`);
    } else {
      res.end(String(err));
    }
    return;
  }

  const ipfs = create();

  // Get content CID
  const path = files.file[0].filepath;
  debug('TACA ===> POST request /api/is_content_existed, path = ', path);
  const file = await ipfs.add(fs.createReadStream(path), { onlyHash: true });
  debug('TACA ===> POST request /api/is_content_existed, file = ', file);
  const fileCID = file.cid.toString();
  debug('TACA ===> POST request /api/is_content_existed, fileCID = ', fileCID);

  // Check if the content is already existed on our server
  let isExisted = false;
  try {
    for await (const { cid, type } of ipfs.pin.ls({ paths: fileCID })) {
      debug('TACA ===> POST request /api/is_content_existed, cid = ', cid, ', type = ', type);
      isExisted = true;
      break;
    }
  } catch (error) {
    debug('TACA ===> POST request /api/is_content_existed, error = ', error);
    isExisted = false;
  }

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
var server = app.listen(app.get('port'), '::', function () {
  debug('Express server listening on port ' + server.address().port);
});
