/*
 * @license bindtable v0.1.0
 * (c) 2015 James Moore http://knowthen.com
 * License: MIT
 */
(function(){
'use strict';

angular.module('bindtable', [])
  .provider('bindTableFactory', bindTable);

function bindTable () {
  this.$get = ['$rootScope', '$q', bindTableFactory];
}

function bindTableFactory ($rootScope, $q) {
  return function (options){
    if(!options || !options.socket){
      throw new Error('must supply a socket io connection');
    }
    var listenerIdCounter = 0;
    var socket = options.socket;
    return function createTable(tableName, tableOptions){
      var table = {};
      tableOptions = tableOptions || {};
      if(listenerIdCounter > 10000){
        listenerIdCounter = 0;
      }

      table.listenerId = ++listenerIdCounter;
      table.rows = [];
      table.row = {};
      table.tableName = tableName;
      table.addEventName = options.addEventName 
        || table.tableName + ':add';
      table.findEventName = options.findEventName 
        || table.tableName + ':findById';
      table.updateEventName = options.updateEventName 
        || table.tableName + ':update';
      table.deleteEventName = options.deleteEventName 
        || table.tableName + ':delete';
      table.startChangesEventName = options.startChangesEventName 
        || tableName + ':changes:start';
      table.endChangesEventName = options.endChangesEventName
        || tableName + ':changes:stop:' + table.listenerId;
      table.startRecordChangesEventName = options.startRecordChangesEventName
        || tableName + ':record:changes:start';
      table.changesEventName = options.changesEventName 
        || tableName + ':changes:' + listenerIdCounter;
      table.stopChangesEventName = options.stopChangesEventName 
        || tableName + ':changes:stop:' + listenerIdCounter;
      // table.endRecordChangesEventName = options.endRecordChangesEventName
      //   || tableName + ':record:changes:stop';
      
      table.sortBy = tableOptions.sortBy || options.sortBy || 'createdAt';

      table.listenEventName = tableName + ':changes:' + table.listenerId;
      table.recordListenEventName = tableName + ':record:changes';
      table.pkName = options.pkName || 'id';
      table.add = addRecord(table, $q, socket);
      table.update = updateRecord(table, $q, socket);
      table.findById = findRecordById(table, $q, socket);
      table.save = function(record){
        if(record.id){
          return this.update(record);
        }
        else{
          return this.add(record);
        }
      }
      table.delete = deleteRecord(table, $q, socket);
      table.bind = bind(table, $q, socket);
      table.bindRecord = bindRecord(table, $q, socket);
      table.unBind = unBind(table, $q, socket);

      return table;
    }
  }
  
}

function addRecord(table, $q, socket){
  return function(record){
    var deffered = $q.defer();
    socket.emit( table.addEventName, record, function(err, record){
      if(err){
        deffered.reject(err);
      }
      else{
        upsertLocalRow(table, record);
        deffered.resolve(record);
      }
    });
    return deffered.promise;
  }
}

function updateRecord(table, $q, socket){
  return function(record){
    var deffered = $q.defer();
    socket.emit(table.updateEventName, record, function(err, result){
      if(err){
        deffered.reject(err);
      }
      else{
        upsertLocalRow(table, record);
        deffered.resolve(result);
      }
    });
    return deffered.promise;
  }
}

function findRecordById(table, $q, socket){
  return function(id){
    var deffered = $q.defer();
    socket.emit(table.findEventName, id, function(err, result){
      if(err){
        deffered.reject(err);
      }
      else{
        deffered.resolve(result);
      }
    });
    return deffered.promise;
  }
}

function deleteRecord(table, $q, socket){
  return function(record){
    var deffered = $q.defer();
    socket.emit(table.deleteEventName, record.id, function(err, result){
      if(err){
        deffered.reject(err);
      }
      else{
        deleteLocalRow(table, record.id);
        deffered.resolve(result);
      }
    });
    return deffered.promise;
  }
}

function upsertLocalRow(table, record){
  var idx = findIndex(table.rows, record, table.pkName);
  if(idx > -1){
    table.rows[idx] = record;
  }
  else{
    idx = findInsertIndex(table, record);
    if(idx > -1){
      table.rows.splice(idx, 0, record);
    }
    else{
      table.rows.push(record);
    }
  }
}

function findInsertIndex(table, record){
  var idx = -1;
  for (var i = 0; i < table.rows.length; i++) {
    if(table.rows[i][table.sortBy] >= record[table.sortBy]){
      idx = i;
      break;
    }
  }
  return idx;
}

function deleteLocalRow(table, id){
  remove(table.rows, id, table.pkName)
}

function findIndex (rows, record, pkName) {
  rows = rows || [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if(row[pkName] === record[pkName]){
      return i;
    }
  };
  return -1;
} 

function remove (rows, id, pkName) {
  rows = rows || [];
  var length = rows.length;
  for (var i = 0; i < length; i++) {
    var row = rows[i];
    if(row[pkName] === id){
      rows.splice(i, 1);
      length--;
    }
  };
}

function updateLocalRows(table, change){
  if(change.new_val === null){
    deleteLocalRow(table, change.old_val.id);
  }
  else{
    upsertLocalRow(table, change.new_val);
  }
}

function bind (table, $q, socket){
  return function (filter, limit, offset){
    var changeOptions = {
      limit: limit || 10,
      offset: offset || 0, 
      filter: filter || {},
      changesEventName: table.changesEventName,
      stopChangesEventName: table.stopChangesEventName,
      listenerId: table.listenerId
    };
    startWatchingChanges(table, socket, changeOptions);
    table.changeHandler = changeHandler(table)
    table.reconnectHandler = reconnect(table, socket, changeOptions);
    socket.on(table.listenEventName, table.changeHandler);
    socket.on('reconnect', table.reconnectHandler);
  }
}

function bindRecord (table, $q, socket){
  return function (id){
    startWatchingRecordChanges(table, socket, id);
    table.recordChangeHandler = recordChangeHandler(table);
    table.recordReconnectHandler = recordReconnect(table, socket, id);
    table.recordListenEventName = table.tableName + ':record:changes:' + id;
    table.endRecordChangesEventName = table.tableName + ':record:changes:stop:' + id;
    socket.on(table.recordListenEventName, table.recordChangeHandler);
    socket.on('reconnect', table.recordReconnectHandler);
  }
}

function reconnect (table, socket, options){
  return function () {
    socket.emit(table.startChangesEventName, options);
  }
}

function startWatchingChanges (table, socket, options) {
  socket.emit(table.startChangesEventName, options);
}

function recordReconnect (table, socket, id){
  return function () {
    socket.emit(table.startRecordChangesEventName, id);
  }
}

function startWatchingRecordChanges (table, socket, id) {
  socket.emit(table.startRecordChangesEventName, id);
}

function changeHandler (table) {
  return function(change, cb) {
    updateLocalRows(table, change);
    if(cb){
      cb(null);
    }
  }
}

function recordChangeHandler(table){
  return function(change, cb){
    if(change.new_val === null){
      table.row = {};
    }
    else{
      copyObject(table.row, change.new_val);
    }
    
  }
}
 
function unBind (table, $q, socket) {
  return function(){
    socket.emit(table.endChangesEventName);
    socket.emit(table.endRecordChangesEventName);
    socket.removeListener(table.listenEventName, table.changeHandler);
    socket.removeListener(table.recordListenEventName, table.recordChangeHandler);
    socket.removeListener('reconnect', table.reconnectHandler);
    socket.removeListener('reconnect', table.recordReconnectHandler);
  }
}

function copyObject(obj/*, …*/) {
  for (var i=1; i<arguments.length; i++) {
    for (var prop in arguments[i]) {
      obj[prop] = arguments[i][prop];
    }
  }
  return obj;
}

})();