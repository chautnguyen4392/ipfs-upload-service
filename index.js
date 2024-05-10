var express = require('express'),
  path = require('path'),
  logger = require('morgan'),
  cookieParser = require('cookie-parser'),
  bodyParser = require('body-parser'),
  debug = require('debug')('ipfs_handler'),
  formidable = require('formidable');

var app = express();

const cors = require('cors');
const PORT = 3000;

app.use(
  cors({
    origin: '*',
  })
);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// ADD POST REQUEST HANDLERS
app.post('/api/ipfsdata', (req, res, next) => {
  debug('TACA ===> /api/ipfsdata, Receive request req = ', req);
  var form = new formidable.IncomingForm();

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
