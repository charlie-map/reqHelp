require('dotenv').config();
const mysql = require('mysql');
let express = require('express');
const app = express();
const bodyParser = require('body-parser');
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const {
	v4: uuidv4
} = require('uuid');
const morgan = require('morgan');

//auth stuff
const sessionStore = require('sessionstorage');
const session = require('express-session');
const flash = require('connect-flash');

//ALL BCRYPT
const bcrypt = require('bcrypt');
const saltRounds = 10;

const connection = mysql.createConnection({
	host: 'localhost',
	user: 'newuser',
	password: 'yurioIsVeryHot6969',
	database: 'helper'
});

connection.connect((err) => {
	if (err) throw err;
});

const isLoggedIn = async function(userInfo) {
	//take users token and check against the tokens table
	let currentTime = Date.now();
	let tokenCheck = () => {
		return new Promise((resolve, reject) => {
			connection.query("SELECT * FROM tokens WHERE token=?", userInfo.token, (err, row) => {
				if (err) console.log("token selection error");
				//if there's a row --> check to see how different current date versus expirey are, then run based on that
				//subtract row from current time to see the difference
				let diff = currentTime - row[0].expire;
				//devide the number by another huge number to get the estimated hours -- above 8, and it's cut off
				diff = diff / 3600000; //milliseconds in hours
				if (diff > 8) {
					resolve(false);
				} else {
					resolve(true);
				}
			});
		});
	};
	let isValid = await tokenCheck();
	try {
		return isValid;
	} catch (error) {
		if (error) return (false, error);
	}
};

app.use(express.static(__dirname + '/public'));
app.set('views', __dirname + '/views');
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(flash());
app.use(morgan('dev'));
app.get("/", (req, res) => {
	res.sendFile(__dirname + "/views/display.html");
});

io.on('connection', socket => {
	socket.on('signUp', function(userInfo) {
		let username = userInfo.username;
		//need to add person into the database after encrypting their password
		//make sure username doesn't exist
		connection.query("SELECT * FROM teachers WHERE username=?", username, async (err, row) => {
			if (err) console.log("selection error");
			if (!row.length && username != "teachers" && username != "tokens") {
				let hashValue = await (bcrypt.hash(userInfo.password, saltRounds, function(err, hash) {
					//put into teachers table
					let teacherID = uuidv4().substring(0, 6);
					connection.query("INSERT INTO teachers SET username=?, password=?, roomID=?, myname=?, teacherSocket=?", [username, hash, teacherID, "teacher", socket.id], (err) => {
						if (err) throw err;
						//create token
						let preToken = uuidv4();
						sessionStore.setItem('token', preToken);
						connection.query("INSERT INTO tokens(token, expire) VALUES(?, ?)", [preToken, Date.now()], (err) => {
							if (err) console.log("token insertion error");
							socket.emit('toTable', {
								token: preToken,
								username: username,
								teachname: "teacher",
								yourRoomCode: teacherID
							});
						});
					});
				}));
			} else {
				socket.emit('usernameTaken');
			}
		});
	});
	socket.on('login', async (userInfo) => {
		let username = userInfo.username;
		//first check to see if the user exists, then check password, then start a session storag to keep track of them
		let loginQuery = () => {
			return new Promise((resolve, reject) => {
				sessionStore.setItem('username', username);
				connection.query("SELECT * FROM teachers WHERE username=?", username, async (err, row) => {
					if (err) console.log(err);
					if (row.length) {
						let password = userInfo.password;
						bcrypt.compare(password, row[0].password, function(err, result) {
							if (err) console.log("password err");
							if (!result) {
								resolve('incorrectPassword');
							} else {
								//store teachers new socket.id
								connection.query("UPDATE teachers SET teacherSocket=? WHERE id=?", [socket.id, row[0].id], (err) => {
									if (err) console.log("update teachers err");
									//start a session storage with a token value <-- based on their username? sure why not
									let preToken = uuidv4();
									sessionStore.setItem('token', preToken);
									connection.query("INSERT INTO tokens(token, expire) VALUES(?, ?)", [preToken, Date.now()], (err) => {
										if (err) console.log("insert to tokens err", err);
										let myname = row[0].myname;
										!(myname) && (myname = "teacher");
										resolve(['toTable', preToken, myname, row[0].roomID]);
									});
								});
							}
						})
					} else {
						resolve('usernameNotExist');
					}
				});
			});
		};
		let logCheck = await loginQuery();
		if (logCheck == "usernameNotExist") {
			socket.emit(logCheck);
		} else if (logCheck == "incorrectPassword") {

			socket.emit(logCheck);
		} else {
			socket.emit(logCheck[0], {
				token: logCheck[1],
				username: username,
				teachname: logCheck[2],
				yourRoomCode: logCheck[3]
			});
		}
	});
	socket.on('teacherStartingClass', async function(userInfo) {
		//first check to see if it's the person we think it is
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			//need to create the private room using the teachers name
			//then create a seperate table to store the information
			//use a random room code for the room
			socket.join(userInfo.newRoomCode);
			//create new table for this room
			connection.query("DROP TABLE IF EXISTS " + userInfo.newRoomCode, (err) => {
				if (err) console.log("dropping table error", err);
				connection.query("CREATE TABLE " + userInfo.newRoomCode + "(id INT AUTO_INCREMENT, studentName VARCHAR(255) NOT NULL, needHelp TINYINT(1) NOT NULL, inQueue TINYINT(1), PRIMARY KEY(id))", (err) => {
					if (err) console.log("create table with user err", err);
					socket.emit('cleanTeacherRoomStart');
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentJoin', function(userInfo) {
		console.log("student joined");
		//check the room id they are trying to join
		connection.query("SHOW TABLES LIKE ?", userInfo.teachID, (err, row) => {
			//no answer, room is not active
			if (err) console.log("show teacher table err");
			if (row.length) {
				console.log("tablea live");
				connection.query("INSERT INTO " + userInfo.teachID + "(studentName, needHelp, inQueue) VALUES(?, ?, ?)", [userInfo.name, 0, 0], (err, row) => {
					if (err) console.log("selecting room error", err);
					socket.join(userInfo.teachID);
					//notify the main socket only
					connection.query("SELECT teacherSocket FROM teachers WHERE roomID=?", userInfo.teachID, (err, row) => {
						if (err) console.log("teacher socket selection err");
						console.log("the student joined", row[0].teacherSocket);
						//based on locked room will decide if the person joins or is put in queue
						io.to(row[0].teacherSocket).emit('studentHasJoinedTheRoom', {name: userInfo.name});
						socket.emit('teacherRoomJoined');
					});
				});
			} else {
				socket.emit('teachRoomNoExist');
			}
		});
	});
	socket.on('disconnect', function() {
		console.log("disconnecting");
		//delete them from the database
		//first check to see if they're a teacher (meaning they have something to delete)
		let token = sessionStore.getItem('token');
		console.log("token", token);
		if (token != null) {
			connection.query("DELETE FROM tokens WHERE token=?", token, (err) => {
				if (err) console.log("token deletion error", err);
				connection.query("DROP TABLE " + sessionStore.getItem('username'), (err) => {
					if (err) console.log("drop table error");
				});
			});
		}
	});
});

server.listen(4209, () => {
	console.log("server go vroom");
})