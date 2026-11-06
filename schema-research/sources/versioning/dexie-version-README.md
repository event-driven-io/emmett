---
layout: docs
title: 'Dexie.version()'
---

### Syntax

```javascript
db.version(versionNumber)
```

### Parameters
<table>
<tr><td>versionNumber : Number</td><td>The version to declare</td></tr>
</table>

Note the backend DB will get the given version number multiplied by 10. See [Issue #59](https://github.com/dexie/Dexie.js/issues/59) where the reason for this behavior is described.

### Return Value

[Version](/docs/Version/Version)

### Sample

This sample shows how to upgrade your database. Assume your first app defines version 1 of the database like this:

```javascript
var db = new Dexie("FriendsAndPetsDatabase");
db.version(1).stores({
    friends: "++id,name,age",
    pets: "++id,name,kind"
});
db.open(); 

// Do some application logic on the database:
db.transaction("rw", db.friends, db.pets, function () {
    db.friends.add({name: "David", age: 40, sex: "male"});
    db.friends.add({name: "Ylva", age: 39, sex: "female"});
    db.pets.add({name: "Josephina", kind: "dog"});

    db.friends.where("name").equalsIgnoreCase("david").each(function(friend) {
        console.log("Found friend: " + friend.name);
    });
    db.pets.where("kind").anyOf("dog", "cat").each(function(pet) {
        console.log("Found dog or cat: " + pet.name);
    });
}).catch (function (e) {
    console.error(e.stack || e);
});
```

Then you realise "age" was not a good thing to store because it will change as time goes by. You want to redesign your app to store birthdate instead. Here is how version 2 of your released app would look:

```javascript
var db = new Dexie("FriendsAndPetsDatabase");
db.version(2).stores({
    friends: "++id,name,birthdate,sex",
    pets: "++id,name,kind"
}).upgrade (tx => {
    var YEAR = 365 * 24 * 60 * 60 * 1000;
    return tx.table("friends").toCollection().modify (friend => {
        friend.birthdate = new Date(Date.now() - (friend.age * YEAR));
        delete friend.age;
    });
});
// If you are on Dexie < 3.0, also keep the declarations previous versions
db.version(1).stores({
    friends: "++id,name,age",
    pets: "++id,name,kind"
});
```

### See Also

[Database Versioning](/docs/Tutorial/Design#database-versioning)

[Version.stores()](/docs/Version/Version.stores())

[Version.upgrade()](/docs/Version/Version.upgrade())
