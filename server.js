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
	host: process.env.HOST,
	user: 'newuser',
	password: process.env.PASSWORD,
	database: process.env.DATABASE
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
				if (row.length) {
					//if there's a row --> check to see how different current date versus expirey are, then run based on that
					//subtract row from current time to see the difference
					let diff = currentTime - row[0].expire;
					//devide the number by another huge number to get the estimated hours -- above 8, and it's cut off
					diff = diff / 3600000; //milliseconds in hours
					if (diff > 8) {
						resolve(false);
					} else {
						//reset the expiry date
						connection.query("UPDATE tokens SET expire=? WHERE token=?", [currentTime, userInfo.token], (err) => {
							if (err) console.log("updating tokens messed up");
							resolve(true);
						});
					}
				} else {
					resolve(false);
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
	socket.emit('authCheckForDis');
	socket.on('authCheckForDisTrue', async (userInfo)=> {
		let logged = await isLoggedIn(userInfo.token);
		if (logged) {
			connection.query("SELECT * FROM tokens WHERE token=?", userInfo.token, (err, row)=> {
				if (err) console.log("SELECTIONG from tokens with token during auth");
				connection.query("SELECT * FROM teachers WHERE usernme=?", row[0].username, (err, row2)=> {
					if (err) console.log("SELECT teach expire time FROM teachers");
					if (Date.now() - row2[0].teachExpireTime > 300000) {
						connection.query("SHOW TABLES LIKE ?", row2[0].roomID, (err, row3) => {
							if (err) console.log("show tables error");
							if (row3.length) {

							} else {
								socket.emit('toTable', {
									token: userInfo.token,
									username: row[0].username,
									teachname: row2[0].myname,
									yourRoomCode: row2[0].roomID
								});
							}
						});
					}
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
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
						connection.query("INSERT INTO tokens(token, expire, username) VALUES(?, ?, ?)", [preToken, Date.now(), username], (err) => {
							if (err) console.log("token insertion error", err);
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
										sessionStore.setItem('teacherIDCode', row[0].roomID);
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
			//add a boolean on the end of newRoomCode to tell if the student auto joins or not
			userInfo.newRoomCode += userInfo.closedOrOpen == "true" ? "1" : "0";
			connection.query("DROP TABLE IF EXISTS " + userInfo.newRoomCode, (err) => {
				if (err) console.log("dropping table error", err);
				connection.query("CREATE TABLE " + userInfo.newRoomCode + "(id INT AUTO_INCREMENT, studentName VARCHAR(255) NOT NULL, needHelp TINYINT(1) NOT NULL, inQueue TINYINT(1), studentID CHAR(20), PRIMARY KEY(id))", (err) => {
					if (err) console.log("create table with user err", err);
					socket.emit('cleanTeacherRoomStart');
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('newTeacherDisplayName', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("UPDATE teachers SET myname=? WHERE username=?", [userInfo.name, userInfo.username], (err) => {
				if (err) console.log("UPDATE teachers error");
				socket.emit('toTable', {
					teachname: userInfo.name
				})
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentKickedFromRoom', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			//delete that student value from the database
			userInfo.closedOrOpen = userInfo.closedOrOpen ? 1 : 0;
			connection.query("DELETE FROM " + userInfo.teachRoomCode + userInfo.closedOrOpen + " WHERE studentName=? AND studentID=?", [userInfo.studentName, userInfo.studentID], (err) => {
				if (err) console.log("deletion from teacher database");
				//shoot student back to the open screen
				io.to(userInfo.studentID).emit('studentGotKickedFromRoom', {
					teacherRoom: userInfo.teacherName
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentCanJoinTeacherRoom', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			//tell the student to "join" the room --> send them to the home screen
			io.to(userInfo.studentID).emit('trueJoinTeacherRoom', {
				studentName: userInfo.studentName,
				teacherName: userInfo.teacherName
			})
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentJoin', function(userInfo) {
		//check the room id they are trying to join <-- need to check for both zero and one
		connection.query("SHOW TABLES LIKE ?", userInfo.teachID + "1", (err, row1) => {
			//no answer, room is not active
			if (err) console.log("show teacher table err");
			connection.query("SHOW TABLES LIKE ?", userInfo.teachID + "0", (err, row2) => {
				if (err) console.log("show table non private err");
				//based on if we get row1 or row2, slightly different thing will happen for student
				if (row1.length || row2.length) {
					//closed room
					let boolVal = row1.length != 0 ? 1 : 0;
					connection.query("INSERT INTO " + userInfo.teachID + boolVal + "(studentName, needHelp, inQueue, studentID) VALUES(?, ?, ?, ?)", [userInfo.name, 0, boolVal, socket.id], (err, row) => {
						if (err) console.log("selecting room error", err);
						socket.join(userInfo.teachID);
						//notify the main socket only
						connection.query("SELECT teacherSocket, myname FROM teachers WHERE roomID=?", userInfo.teachID, (err, row) => {
							if (err) console.log("teacher socket selection err");
							//based on locked room will decide if the person joins or is put in queue
							//now!
							let studentBool, teacherEmit;
							boolVal == 1 ? (studentBool = 1, teacherEmit = "studentHasJoinedTheRoomQueue") :
								(studentBool = 0, teacherEmit = "studentHasJoinedTheRoom");
							io.to(row[0].teacherSocket).emit(teacherEmit, {
								name: userInfo.name,
								studentSocket: socket.id
							});
							socket.emit('teacherRoomJoined', {
								teacherName: row[0].myname,
								queueOrJoin: studentBool
							});
						});
					});
				} else {
					socket.emit('teachRoomNoExist');
				}
			});
		});
	});
	socket.on('thisStudentNeedsHelp', (userInfo) => {
		//check that the room exists
		connection.query("SHOW TABLES LIKE ?", userInfo.currentRoom + userInfo.closedOrOpen, (err, row) => {
			if (err) console.log("showing student needs help tables err");
			if (row.length) {
				//select the teachers information from database
				connection.query("SELECT teacherSocket FROM teachers WHERE roomID=?", userInfo.currentRoom, (err, row2) => {
					if (err) console.log("select from teachers roomID err");
					io.to(row2[0].teacherSocket).emit('studentNeedsHelpFromTeach', {
						studentSocket: socket.id,
					});
				});
			} else {
				socket.emit('teachRoomNoExist');
			}
		});
	});
	socket.on('studentHasBeenHelped', (userInfo) => {
		io.to(userInfo.studentID).emit('teacherHasHelpedYou');
	});
	socket.on('studentLeavingSite', function(userInfo) {
		//see if they are currently in a room
		if (userInfo.currentRoom != null & userInfo.currentRoom != undefined) {
			//tell the teacher that the student is leaving
			connection.query("SELECT teacherSocket FROM teachers WHERE roomID=?", userInfo.currentRoom, (err, row) => {
				if (err) console.log("selecting teacher socket from teachers err");
				io.to(row[0].teacherSocket).emit('aStudentLeftTheRoom', {
					studentName: userInfo.studentName,
					studentSocket: socket.id
				});
			});
		}
	});
	socket.on('teacherLeavingSite', async function(userInfo) {
		//delete them from the database
		//first check to see if they're a teacher (meaning they have something to delete)
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("DELETE FROM tokens WHERE token=?", userInfo.token, (err) => {
				if (err) console.log("token deletion error", err);
				let numAnswer = userInfo.closedOrOpen == "true" ? 1 : 0;
				//make sure table isn't there
				connection.query("SHOW TABLES LIKE ?", userInfo.teacherIDCode + numAnswer, (err, row) => {
					if (err) console.log("showing tables error on leaving site", err);
					if (row.length) {
						connection.query("DROP TABLE ?", userInfo.teacherIDCode + numAnswer, (err) => {
							if (err) console.log("drop table error", err);
						});
					}
				});
			});
		} else {
			//doesn't matter lol goodbye
		}
	});
	socket.on('disconnect', function() {
		connection.qeuery("SELECT username FROM teachers WHERE teacherSocket=?", socket.id, (err, row)=> {
			if (err) console.log("teacher for disconnect selection error");
			if (row.length) {
				connection.query("INSERT INTO teachers (teachExpireTime) VALUES(?) WHERE username=?", [Date.now(), row[0].username], (err)=> {
					if (err) console.log("INSERTION into teachers expiry time error");
				});
			}
		});
	});
});

server.listen(4209, () => {
	console.log("server go vroom");
})