# sails-hook-serializer

This project was created under the impression of [ActiveModelSerializers Rails gem](https://github.com/rails-api/active_model_serializers) 

## Installation

```
$ npm install --save sails-hook-serializer
```

create Serializer.js file in your services folder with content :

```
module.exports = require('sails-hook-serializer/api/services/Serializer.js');
```

## Customization

By default for all your models will created serializer in runtime. 
For customization create folder serializers under api deirectory and put here you custom serializers.
For example:

```
//api/serializers/UserSerializer.js

module.exports = {
  attributes: [
    'email',
    'firstName',
    'lastName',
    'phone',
    'anyCustomAttribute'
  ],

  anyCustomAttribute: function(record) {
    return record.id * 10  - 999;
  },
	
  modifyAttributes: function(record, serialized, currentUser) {
    serialized.newAttr = record.myAnotherAttr;
  }
};	
```

Attributes - it's array of fields that result json will have. 
Attribute can be attribute of a record or serializer.

At the end of serialization method modifyAttributes invokes. Inside this method any data can be modified.

All methods can return promise.

## Call Serializer

```
new Serializer(User, users, currentUser, meta)
```

First argument is model name, second record or array of records. 