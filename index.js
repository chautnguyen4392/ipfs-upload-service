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
  const tx = req.body.timelocktx;
  debug('TACA ===> /api/add_ipfs_content, tx = ', tx);

  // Get uploaded file from form data
  let fields, files;
  try {
    [fields, files] = await form.parse(req);
    debug('TACA ===> POST request /api/add_ipfs_content, fields = ', fields, ', files = ', files);
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

  // Check if the content is already existed on our server
  const isExisted = await isFileExisted(files.file[0].filepath);
  if (isExisted) {
    const error = `The upload file ${files.file[0].originalFilename} was already existed on the system. Please upload another file.`;
    console.error(error);
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(error);
  }

  // Add file
  const { cidv0, cidv1 } = await addFile(files.file[0].filepath);
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
    console.error('Failed to parse form with error: ', err);
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
var server = app.listen(app.get('port'), '::', function () {
  debug('Express server listening on port ' + server.address().port);
});
