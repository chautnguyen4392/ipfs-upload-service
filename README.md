### Create database

Enter MongoDB cli:

    $ mongo

Create databse:

    > use ipfsuploaddb

Create user with read/write access:

    > db.createUser( { user: "admin", pwd: "admin", roles: [ "readWrite" ] } )

*Note: If you're using mongo shell 4.2.x, use the following to create your user:

    > db.addUser( { user: "username", pwd: "password", roles: [ "readWrite"] })
