#!/usr/bin/env node
'use strict';

/*
 * How it workrs:
 * 1. Loads info about all files
 * 2. Filtering out oldest
 * 3. Mapping out ids
 * 4. Deleting old files
 * */

const _ = require('lodash');
const url = require('url');
const async = require('async');
const request = require('xhr-request');
const program = require('commander');

const pkg = require('./package.json');
const defaultDays = 30;

// Slack API endpints
const slackFilesList = 'https://slack.com/api/files.list';
const slackFileDelete = 'https://slack.com/api/files.delete';

program
  .version(pkg.version)
  .option('-t, --token [token]', 'Slack token, you can get one here https://api.slack.com/docs/oauth-test-tokens')
  .option('-d, --days [days]', 'Delete files older that `n` days, default is 30 days', defaultDays)
  .parse(process.argv);

if (!program.token) {
  throw new Error('Slack API token is required');
}

// Helpers

function formatUrl(uri, _s) {
  const query = Object.assign({}, _s, {
    token: program.token
  });

  return url.format(Object.assign(url.parse(uri), {query}));
}

// Files loading

function loadFilesPage(page, cb) {
  const uri = formatUrl(slackFilesList, {page});

  request(uri, {method: 'GET', json: true}, cb);
}

function loadAllFiles(cb) {
  const allFiles = [];

  loadFilesPage(0, (err, data) => {
    if (err) {
      return cb(err);
    }

    allFiles.push(data.files);

    return async.map(_.range(data.paging.page + 1, data.paging.pages + 1), loadFilesPage, (err, filesData) => {
      _.each(filesData, filesDataPage => allFiles.push(filesDataPage.files));
      return cb(err, _.flatten(allFiles));
    });
  });
}

// Files filtering

function filterOldFiles(files) {
  // 24 * 60 * 60 * 1000
  const msPerDay = 86400000;
  const msPerSec = 1000;
  const now = Date.now();
  const diff = msPerDay * parseInt(program.days, 10);

  function isOld(d1, d2) {
    return d2 - d1 > diff;
  }

  return _.filter(files, file => isOld(file.created * msPerSec, now));
}

// Delete file
function deleteFile(fileId, cb) {
  const uri = formatUrl(slackFileDelete, {file: fileId});

  request(uri, {method: 'POST', json: true}, cb);
}

// App entry points

loadAllFiles((err, files) => {
  if (err) {
    throw err;
  }

  const oldFiles = filterOldFiles(files);
  const fileIds = _.map(oldFiles, 'id');
  const maxParallelReq = 10;

  console.log(`Found ${fileIds.length} old files`);

  async.eachLimit(fileIds, maxParallelReq, deleteFile, (errDeletingFiles) => {
    if (errDeletingFiles) {
      throw errDeletingFiles;
    }

    console.log('All old files successfully deleted');
  });
});
