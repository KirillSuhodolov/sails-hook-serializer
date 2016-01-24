var _             = require('lodash');
var pluralize     = require('pluralize');
var Promise       = require("bluebird");
var actionUtil    = {
  isKey: function(possibleKey) {
    return _.isNumber(possibleKey) || _.isString(possibleKey);
  }
};

function Serializer (model, records, currentUser, meta) {
  var Serializer = this;

  this.waitPromises = function() {
    return Promise.all(this.promises).then(function(result){
      if (result.length === Serializer.promises.length) {
        return Serializer.json;
      } else {
        sails.log.debug('waitPromises');

        return Serializer.waitPromises();
      }
    });
  };

  this.initialize = function(model, records, currentUser) {
    var serializer = this.findSerializer(model.identity);

    this.model = model;
    this.plural = _.isArray(records);
    this.records = records;
    this.associations = model.associations;
    this.currentUser = currentUser;
    //Test feature, use at your own risk
    this.recursive = !!serializer.recursive;
    this.createDocumentIdentifier();
    this.prepareJson();
    this.promises = [];
  };

  this.findSerializer = function(identity) {
    var serializer = sails.serializers[identity];

    if (!serializer) {
      sails.log.debug('Model haven\'t got serializer.', this.model);
    }

    return serializer;
  };

  this.createDocumentIdentifier = function() {
    var documentIdentifier = this.plural ? pluralize(this.model.globalId) : this.model.globalId;
    this.documentIdentifier = _.camelCase(documentIdentifier);
  };

  this.prepareJson = function() {
    var json = {};
    json[ this.documentIdentifier ] = this.plural ? [] : {};
    this.json = json;
  };

  this.prepareMeta = function(meta) {
    this.json.meta = meta || {};
  };

  this.filterSideloadAssociations = function(identity, globalId) {
    var serializer = this.findSerializer(identity);
    var sideloadAssociations = serializer.sideload;
    var model = sails.models[identity];
    var associations = model.associations;

    if (_.isBoolean(sideloadAssociations)) { return sideloadAssociations ? associations : []; }
    if (_.isArray(sideloadAssociations)) {
      return _.filter(associations, function(assoc) { return _.includes(sideloadAssociations, assoc.alias); });
    }
    if (_.isNull(sideloadAssociations)) { return []; }
    if (_.isUndefined(sideloadAssociations)) { return []; }
  };

  this.processOrFind = function(records, identity, globalId) {
    if (this.recursive) {
      if (_.isArray(records)) {
        return this.getCollection(records, identity, globalId);
      } else {
        return this.getOneRecord(records, identity, globalId);
      }
    } else {
      return new Promise(function (resolve){
        if (_.isArray(records)) {
          resolve(Serializer.prepareCollection(records, identity, globalId));
        } else {
          resolve(Serializer.prepareOneRecord(records, identity, globalId));
        }
      });
    }
  };

  this.prepareCollection = function(records, identity, globalId) {
    return _.map(records, function(record){
      return Serializer.prepareOneRecord(record, identity, globalId);
    });
  };

  this.prepareOneRecord = function(record, identity, globalId) {
    var Model = sails.models[identity];
    var associations = Model.associations;
    var filteredAssociations = this.filterSideloadAssociations(identity, globalId);

    var processRecord = function(record){
      if (actionUtil.isKey(record)) { return record }

      record = Serializer.createJson(record, identity, globalId);

      _.forEach(associations, function(assoc) {
        var assocName;

        if (assoc.type === 'collection') {
          assocName = pluralize(_.camelCase(sails.models[assoc.collection].globalId));
        } else {
          assocName = pluralize(_.camelCase(sails.models[assoc.model].globalId));
        }

        if ( assoc.type === "collection" && record[ assoc.alias ] && record[ assoc.alias ].length > 0 ) {
          if (_.includes(filteredAssociations, assoc) ) {
            Serializer.fillInJson(record[assoc.alias], assoc.collection, _.camelCase(sails.models[assoc.collection].globalId)).then(function(result){
              Serializer.findBookedPlace(result, assocName);
            });
          }

          record[ assoc.alias ] = _.pluck( record[ assoc.alias ], 'id' );
        }

        if ( assoc.type === "model" && record[ assoc.alias ] ) {
          if (_.includes(filteredAssociations, assoc) ) {
            Serializer.fillInJson(record[assoc.alias], assoc.model, _.camelCase(sails.models[assoc.model].globalId)).then(function(result){
              Serializer.findBookedPlace(result, assocName);
            });
          }
          var resultRecord = record[ assoc.alias ];

          if (!actionUtil.isKey(resultRecord)) {
            record[ assoc.alias ] = resultRecord.id;
          }
        }
      });

      return record;
    };

    return processRecord(record);
  };

  this.createJson = function(record, identity, globalId) {
    var json = {id: record.id};
    var serializer = this.findSerializer(identity);

    _.forEach(serializer.attributes, function(attribute){
      if (serializer.hasOwnProperty(attribute)) {
        var result = serializer[attribute](record, json, Serializer.currentUser);

        if (Serializer.isPromise(result)) {
          Serializer.promises.push(result);
        } else {
          json[attribute] = serializer[attribute](record, json, Serializer.currentUser);
        }
      } else if (_.isArray(record[attribute])) {
        json[attribute] = record[attribute].map(function(iterationRecord) {
          return (_.isObject(iterationRecord) && iterationRecord.hasOwnProperty('id')) ? iterationRecord.id : iterationRecord;
        });
      } else if (_.isObject(record[attribute]) && record[attribute].hasOwnProperty('id')) {
        json[attribute] = record[attribute].id;
      } else {
        json[attribute] = record[attribute];
      }
    });

    if (serializer.hasOwnProperty('modifyAttributes')) {
      if (this.currentUser) {
        var result = serializer.modifyAttributes(record, json, this.currentUser);

        if (Serializer.isPromise(result)) {
          Serializer.promises.push(result);
        }
      }
    }

    return json;
  };

  this.isPromise = function(object) {
    return object instanceof Object && _.includes(object.toString(), 'Promise');
  };

  this.filterDuplicatesAtSideload = function() {
    _.forEach( this.json, function ( array, key ) {
      if (key === Serializer.documentIdentifier) {
        if ( !Serializer.plural ) { return; }
      } else {
        if (_.isArray(Serializer.json[key]) && !Serializer.json[key].length) { delete Serializer.json[key]; }
      }

      Serializer.json[ key ] = _.uniq( array, function ( record ) {
        return record.id;
      });
    });
  };

  this.fillInJson = function(records, identity, globalId) {
    var promises = [],
      result;

    var processRecords = function(records) {
      Serializer.bookingPlace(records, identity, globalId);
      result = Serializer.processOrFind(records, identity, globalId);
      Serializer.promises.push(result);
      promises.push(result);
    };

    if (_.isArray(records)) {
      records = _.filter(records, function(record){ return !Serializer.isRecordSerialized(record, identity, globalId); });

      processRecords(records);
    } else {
      if (!this.isRecordSerialized(records, identity, globalId)) {
        processRecords(records);
      }
    }

    return Promise.all(promises);
  };

  this.isRecordSerialized = function(record, identity, globalId) {
    globalId = _.camelCase(globalId);
    var pluralizedIdentity = pluralize(_.camelCase(globalId));
    var ids = _.pluck(this.json[pluralizedIdentity], 'id');

    //sails.log.debug('isRecordSerialized inner', identity, ids, record.id, _.includes(ids, record.id));

    if (!this.plural && this.isRecordMain(record, identity, globalId)) {
      return this.json[globalId].id === record.id;
    } else if (this.json[pluralizedIdentity]) {
      return _.includes(ids, record.id);
    } else {
      return false;
    }
  };

  this.bookingPlace = function(records, identity, globalId) {
    globalId = _.camelCase(globalId);

    var processRecord = function(record) {
      if (Serializer.isRecordMain(record, identity, globalId)) {
        Serializer.json[globalId] = {id: record.id};
      } else {
        var pluralizedIdentity = pluralize(_.camelCase(globalId));
        Serializer.json[pluralizedIdentity] = Serializer.json[pluralizedIdentity] || [];
        Serializer.json[pluralizedIdentity] = Serializer.json[pluralizedIdentity].concat({id: record.id});
      }
    };

    if (_.isArray(records)) {
      if (_.every(records, function(el){ return actionUtil.isKey(el); })) { return; }

      _.forEach(records, function(record){
        processRecord(record);
      });
    } else {
      if (actionUtil.isKey(records)) { return; }
      processRecord(records);
    }
  };

  this.findBookedPlace = function(result, assocName){
    if (_.isArray(result)) {
      result = _.flatten(result);
      if (_.every(result, function(el){ return actionUtil.isKey(el); })) { return; }

      var ids = _.pluck(result, 'id');

      _.remove(Serializer.json[assocName], function(el) {
        return _.includes(ids, el.id);
      });
    } else {
      if (actionUtil.isKey(result)) { return; }
    }

    this.json[assocName] = this.json[assocName].concat(result);
  };

  this.isRecordMain = function(record, identity, globalId) {
    return  _.camelCase(this.model.globalId) === globalId && this.records.id === record.id;
  };

  this.initialize(model, records, currentUser);

  this.fillInJson(records, model.identity, _.camelCase(model.globalId)).then(function(result) {
    result = _.flatten(result);

    Serializer.json[Serializer.documentIdentifier] = Serializer.plural ? result : result[0] ;
  });

  //Methods below works only with recursive = true, working in current moment with bugs
  this.getOneRecord = function(record, identity, globalId) {
    var Model = sails.models[identity];

    return Model.findOne({id: record.id}).populateAll().then(function(record){
      return Serializer.prepareOneRecord(record, identity, globalId);
    });
  };

  this.getCollection = function(records, identity, globalId) {
    var Model = sails.models[identity];
    var ids = _.map(records, function(record){ return { id: record.id }; });

    return Model.find(ids).populateAll().then(function(records){
      return Serializer.prepareCollection(records, identity, globalId);
    });
  };

  this.filterDuplicatesAtSideload();

  this.prepareMeta(meta);

  return this.waitPromises();
}

module.exports = Serializer;
