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
	if (userInfo.token == null) {
		return false;
	}
	let currentTime = Date.now();
	let tokenCheck = () => {
		return new Promise((resolve, reject) => {
			connection.query("SELECT * FROM tokens WHERE token=? AND teacherUsername=?", [userInfo.token, userInfo.username], (err, row) => {
				if (err) reject(err);
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
						connection.query("UPDATE tokens SET expire=? WHERE token=? AND teacherUsername=?", [currentTime, userInfo.token, userInfo.username], (err) => {
							if (err) reject(err);
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

const timeoutCheck = async function(socket) {
	let timeoutChecker = () => {
		return new Promise((reject, resolve) => {
			connection.query("SELECT meetingTimeoutMinutes, meetingTimeoutExpiry FROM teachers WHERE teacherSocket=?", socket, (err, row) => {
				if (err) reject(err);
				if (row.length) {
					//compare them with current date
					if (row[0].meetingTimeoutExpiry - Date.now() < row[0].meetingTimeoutMinutes * 60000) reject(true);
					reject(false);
				} else {
					reject(false);
				}
			});
		});
	};
	try {
		let checked = await timeoutChecker();
		return checked;
	} catch (error) {
		return error;
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

async function checkForRoomClosure() {
	//grab every single live room, check them for activity
	//delete the students from the db, and then send teacher back to table
	connection.query("SELECT teacherSocket, roomID FROM teachers WHERE roomOpen=1", async (err, rows) => {
		if (err) socket.emit('errorHandle');
		if (rows.length) {
			for (let i = 0; i < rows.length; i++) {
				//for each active row, check how long they have been active
				let timeout = await timeoutCheck(rows[i].teacherSocket);
				if (timeout == false) {
					//close the room
					connection.query("DELETE FROM classrooms WHERE memberSocket=? AND teacherIdentity IS NULL", rows[i].teacherSocket, (err) => {
						if (err) socket.emit('errorHandle');
						io.to(rows[i].roomID).emit('classHasEnded');
					})
				} else if (timeout != true) {
					socket.emit('errorHandle');
				}
			}
		}
	});
}

setInterval(checkForRoomClosure, 20000);

io.on('connection', socket => {
	socket.emit('authCheckForDis');
	socket.on('authCheckForDisTrue', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("SELECT meetingTimeoutExpiry, roomID, teacherIdentity, myname, meetingTimeoutMinutes FROM teachers WHERE username=?", userInfo.username, (err, row2) => {
				if (err) socket.emit('errorHandle');
				if (row2.length) {
					let token = uuidv4();
					socket.emit('fixInformation', {
						token: token
					});
					connection.query("UPDATE tokens SET token=?, expire=?, userSocket=? WHERE teacherUsername=?", [token, Date.now(), socket.id, userInfo.username], (err) => {
						if (err) socket.emit('errorHandle');
						if (row2[0].meetingTimeoutExpiry - Date.now() < 360000) { // if this is true and at least one person in room, then join the room automatically
							connection.query("UPDATE teachers SET teacherSocket=?, roomOpen=1 WHERE roomID=? AND teacherIdentity=?", [socket.id, row2[0].roomID, row2[0].teacherIdentity], (err) => {
								if (err) socket.emit('errorHandle');
								//either send them to their room or just their table
								connection.query("UPDATE classrooms SET memberSocket=? WHERE roomID=? AND teacherIdentity=?", [socket.id, row2[0].roomID, row2[0].teacherIdentity], (err) => {
									if (err) socket.emit('errorHandle');
									connection.query("SELECT * FROM classrooms WHERE roomID=?", row2[0].roomID, (err, allRows) => {
										if (err) socket.emit('errorHandle');
										//counting teacher, the row rate needs to be higher than 1
										if (allRows.length > 1) {
											//but with this, then need to connect every one of the students, in queue or out of queue to the teacher
											let queueLength = 0;
											allRows.forEach(row => {
												if (!row.teacherIdentity && row.queueing == 1) {
													queueLength++;
													socket.emit('studentHasJoinedTheRoomQueue', {
														name: row.memberName,
														queueLength: queueLength,
														studentSocket: row.memberSocket
													});
												}
											});
											socket.emit('cleanTeacherRoomStart', {
												queueLength: queueLength
											});
											allRows.forEach(row => {
												if (row.memberSocket != socket.id && row.queueing == 0 && row.needHelp) {
													socket.emit('studentHasJoinedTheRoom', {
														name: row.memberName,
														studentSocket: row.memberSocket
													});
													//then need to check these students for if they need help currently
													socket.emit('studentNeedsHelpFromTeach', {
														studentSocket: row.memberSocket
													});
												}
											});
											allRows.forEach(row => {
												if (row.memberSocket != socket.id && row.queueing == 0 && !row.needHelp) {
													socket.emit('studentHasJoinedTheRoom', {
														name: row.memberName,
														studentSocket: row.memberSocket
													});
												}
											});
											//need to run through each student that's not in queue and send a fake in classroom join call to the teacher - done!
										} else {
											console.log("here");
											connection.query("UPDATE teachers SET roomOpen=0 WHERE teacherSocket=?", socket.id, (err) => {
												if (err) socket.emit('errorHandle');
												socket.emit('toTable', {
													token: token,
													username: userInfo.username,
													teachname: row2[0].myname,
													yourRoomCode: row2[0].roomID,
													teacherTimeout: row2[0].meetingTimeoutMinutes
												});
											});
										}
									});
								});
							});
						} else {
							socket.emit('failedAuth');
						}
					});
				} else {
					socket.emit('failedAuth');
				}
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
			if (err) socket.emit('errorHandle');
			if (!row.length && username != "teachers" && username != "tokens" && username != "classrooms") {
				let hashValue = await (bcrypt.hash(userInfo.password, saltRounds, function(err, hash) {
					//put into teachers table
					let teacherID = uuidv4().substring(0, 6),
						teacherFier = uuidv4().substring(0, 6);
					connection.query("INSERT INTO teachers (username, password, roomID, myname, teacherSocket, teacherIdentity) VALUES (?, ?, ?, ?, ?, ?)", [username, hash, teacherID, "teacher", socket.id, teacherFier], (err) => {
						if (err) socket.emit('errorHandle');
						connection.query("INSERT INTO classrooms (memberName, roomID, memberSocket, queueing, needHelp, teacherIdentity) VALUES (?, ?, ?, 0, 0, ?)", 
							["teacher", teacherID, socket.id, teacherFier], (err) => {
							if (err) console.log("classrooms error", err);
							//create token
							let preToken = uuidv4();
							connection.query("INSERT INTO tokens(token, expire, userSocket, teacherUsername) VALUES(?, ?, ?, ?)", [preToken, Date.now(), socket.id, username], (err) => {
								if (err) socket.emit('errorHandle');
								socket.emit('toTable', {
									token: preToken,
									username: username,
									teachname: "teacher",
									yourRoomCode: teacherID,
									teacherTimeout: 30
								});
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
				connection.query("SELECT * FROM teachers WHERE username=?", username, async (err, row) => {
					if (err) socket.emit('errorHandle');
					if (row.length) {
						let password = userInfo.password;
						bcrypt.compare(password, row[0].password, function(err, result) {
							if (err) socket.emit('errorHandle');
							if (!result) {
								resolve('incorrectPassword');
							} else {
								connection.query("DELETE FROM classrooms WHERE roomID=? AND teacherIdentity IS NULL", row[0].roomID, (err) => {
									if (err) socket.emit('errorHandle');
									//store teachers new socket.id
									connection.query("UPDATE teachers SET teacherSocket=?, roomOpen=0 WHERE id=?", [socket.id, row[0].id], (err) => {
										if (err) socket.emit('errorHandle');
										//start a session storage with a token value <-- based on their username? sure why not
										connection.query("UPDATE classrooms SET memberSocket=? WHERE roomID=? AND memberName=?", [socket.id, row[0].roomID, row[0].myname], (err) => {
											if (err) socket.emit('errorHandle');
											let preToken = uuidv4();
											connection.query("UPDATE tokens SET token=?, expire=?, userSocket=? WHERE teacherUsername=?", [preToken, Date.now(), socket.id, username], (err) => {
												if (err) socket.emit('errorHandle');
												sessionStore.setItem('teacherIDCode', row[0].roomID);
												let myname = row[0].myname;
												!(myname) && (myname = "teacher");
												resolve(['toTable', preToken, myname, row[0].roomID, row[0].meetingTimeoutMinutes]);
											});
										});
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
		try {
			if (logCheck == "usernameNotExist") {
				socket.emit(logCheck);
			} else if (logCheck == "incorrectPassword") {
				socket.emit(logCheck);
			} else {
				socket.emit(logCheck[0], {
					token: logCheck[1],
					username: username,
					teachname: logCheck[2],
					yourRoomCode: logCheck[3],
					teacherTimeout: logCheck[4]
				});
			}
		} catch (ERROR) {
			console.log("awaiitng issue", ERROR);
		}
	});
	socket.on('teacherStartingClass', async function(userInfo) {
		//first check to see if it's the person we think it is
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			//need to create the private room using the teachers name
			//then create a seperate table to store the information
			connection.query("DELETE FROM classrooms WHERE roomID=? AND teacherIdentity IS NULL", userInfo.newRoomCode, (err) => {
				if (err) socket.emit('errorHandle');
				connection.query("SELECT meetingTimeoutMinutes FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
					if (err) socket.emit('errorHandle');
					let expireTime = Date.now() + row[0].meetingTimeoutMinutes * 60000;
					connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE teacherSocket=?", [expireTime, socket.id], (err) => {
						if (err) socket.emit('errorHandle');
						socket.join(userInfo.newRoomCode);
						//new plan - just add a students and teachers table that stores all the students
						userInfo.closedRoom = userInfo.closedRoom == "true" ? 1 : 0;
						//need to start time limit for the user's room
						connection.query("UPDATE classrooms SET memberSocket=?, memberName=?, queueing=? WHERE roomID=?", [socket.id, userInfo.displayName, userInfo.closedRoom, userInfo.newRoomCode], (err) => {
							if (err) socket.emit('errorHandle');
							connection.query("UPDATE teachers SET roomOpen=1 WHERE teacherSocket=?", socket.id, (err) => {
								if (err) socket.emit('errorHandle');
								socket.emit('cleanTeacherRoomStart', {
									roomQueue: 0
								});
							});
						});
					});
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
				if (err) socket.emit('errorHandle');
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('newTeacherTimeoutValue', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			let string = userInfo.value;
			let num = string;
			if (typeof string == "string") {
				num = parseInt(string.toString().replace(/\D/g, ''), 10);
			}
			num = num > 240 ? 240 : num;
			connection.query("UPDATE teachers SET meetingTimeoutMinutes=? WHERE teacherSocket=?", [num, socket.id], (err) => {
				if (err) socket.emit('errorHandle');
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentKickedFromRoom', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			//delete that student value from the database
			connection.query("DELETE FROM classrooms WHERE memberSocket=?", userInfo.studentID, (err) => {
				if (err) socket.emit('errorHandle');
				connection.query("SELECT meetingTimeoutMinutes FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
					if (err) socket.emit('errorHandle');
					connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE teacherSocket=?", [Date.now() + row[0].meetingTimeoutMinutes * 60000, socket.id], (err) => {
						if (err) socket.emit('errorHandle');
						//shoot student back to the open screen
						io.to(userInfo.studentID).emit('studentGotKickedFromRoom', {
							teacherRoom: userInfo.teacherName
						});
					});
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentCanJoinTeacherRoom', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("UPDATE classrooms SET queueing=0 WHERE memberSocket=?", userInfo.studentID, (err) => {
				if (err) socket.emit('errorHandle');
				//tell the student to "join" the room --> send them to the home screen
				io.to(userInfo.studentID).emit('trueJoinTeacherRoom', {
					studentName: userInfo.studentName,
					teacherName: userInfo.teacherName
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('studentJoin', function(userInfo) {
		//check the room id they are trying to join <-- need to check for both zero and one
		connection.query("SELECT teacherSocket, roomOpen FROM teachers WHERE roomID=?", userInfo.teachID, (err, checkingRow) => {
			if (err) socket.emit('errorHandle');
			if (checkingRow.length && checkingRow[0].roomOpen == 1) {
				connection.query("SELECT queueing FROM classrooms WHERE roomID=? AND memberSocket=?", [userInfo.teachID, checkingRow[0].teacherSocket], (err, closedRoom) => {
					if (err) socket.emit('errorHandle');
					//closed room <-- either 0 (open) or 1 (closed)
					connection.query("INSERT INTO classrooms (memberName, needHelp, queueing, memberSocket, roomID) VALUES(?, ?, ?, ?, ?)", [userInfo.name, 0, closedRoom[0].queueing, socket.id, userInfo.teachID], (err, row) => {
						if (err) socket.emit('errorHandle');
						socket.join(userInfo.teachID);
						//notify the main socket only
						connection.query("SELECT teacherSocket, myname FROM teachers WHERE roomID=?", userInfo.teachID, (err, row) => {
							if (err) socket.emit('errorHandle');
							//based on locked room will decide if the person joins or is put in queue
							//now!
							connection.query("SELECT COUNT(*) AS number FROM classrooms WHERE roomID=? AND queueing=1", userInfo.teachID, (err, queuedRows) => {
								if (err) socket.emit('errorHandle');
								let studentBool, teacherEmit;
								if (closedRoom[0].queueing == 1) {
									studentBool = 1;
									teacherEmit = "studentHasJoinedTheRoomQueue";
								} else {
									studentBool = 0;
									teacherEmit = "studentHasJoinedTheRoom";
								}
								io.to(row[0].teacherSocket).emit(teacherEmit, {
									name: userInfo.name,
									studentSocket: socket.id,
									queueLength: queuedRows[0].number - 1
								});
								socket.emit('teacherRoomJoined', {
									teacherName: row[0].myname,
									queueOrJoin: studentBool
								});
							});
						});
					});
				});
			} else {
				socket.emit('teachRoomNoExist');
			}
		});
	});
	socket.on('thisStudentNeedsHelp', (userInfo) => {
		//check that the room exists
		//select the teachers information from database
		connection.query("SELECT teacherSocket, meetingTimeoutMinutes FROM teachers WHERE roomID=?", userInfo.currentRoom, (err, row2) => {
			if (err) socket.emit('errorHandle');
			if (row2.length) {
				connection.query("SELECT memberName FROM classrooms WHERE roomID=? AND memberSocket=?", [userInfo.currentRoom, row2[0].teacherSocket], (err, checkReal) => {
					if (err) socket.emit('errorHandle');
					if (checkReal.length) {
						connection.query("UPDATE classrooms SET needHelp=1 WHERE memberSocket=?", socket.id, (err) => {
							if (err) socket.emit('errorHandle');
							io.to(row2[0].teacherSocket).emit('studentNeedsHelpFromTeach', {
								studentSocket: socket.id,
								studentName: userInfo.studentName
							});
							connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE teacherSocket=?", [Date.now() + row2[0].meetingTimeoutMinutes * 60000, row2[0].teacherSocket], (err) => {
								if (err) socket.emit('errorHandle');
							});
						});
					} else {
						socket.emit('teachRoomNoExist');
					}
				});
			} else {
				socket.emit('teachRoomNoExist');
			}
		});
	});
	socket.on('studentHasBeenHelped', (userInfo) => {
		connection.query("UPDATE classrooms SET needHelp=0 WHERE memberSocket=?", userInfo.studentID, (err) => {
			if (err) socket.emit('errorHandle');
			connection.query("SELECT meetingTimeoutMinutes FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
				if (err) socket.emit('errorHandle');
				connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE teacherSocket=?", [Date.now() + row[0].meetingTimeoutMinutes * 60000, socket.id], (err) => {
					if (err) socket.emit('errorHandle');
					io.to(userInfo.studentID).emit('teacherHasHelpedYou');
				});
			});
		});
	});
	socket.on('closeRoom', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("DELETE FROM classrooms WHERE roomID=? AND teacherIdentity IS NULL", userInfo.roomCode, (err) => {
				if (err) socket.emit('errorHandle');
				socket.broadcast.to(userInfo.roomCode).emit('classHasEnded');
				connection.query("SELECT username, myname, roomID, meetingTimeoutMinutes FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
					if (err) socket.emit('errorHandle');
					connection.query("SELECT token FROM tokens WHERE userSocket=?", socket.id, (err, rowToken) => {
						if (err) socket.emit('errorHandle');
						connection.query("UPDATE teachers SET roomOpen=1 WHERE teacherSocket=?", socket.id, (err) => {
							if (err) socket.emit('errorHandle');
							if (row.length && rowToken.length) {
								socket.emit('toTable', {
									token: rowToken[0].token,
									username: row[0].username,
									teachname: row[0].myname,
									yourRoomCode: row[0].roomID,
									teacherTimeout: row[0].meetingTimeoutMinutes

								});
							}
						});
					});
				});
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('disconnect', function() {
		connection.query("SELECT username FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
			if (err) socket.emit('errorHandle');
			if (row.length) {
				connection.query("UPDATE teachers SET teachExpireTime=? WHERE username=? AND teacherSocket=?", [Date.now(), row[0].username, socket.id], (err) => {
					if (err) socket.emit('errorHandle');
					//wait to see if there's reconnect within time limit
				});
			} else {
				//delete them from classrooms if they are in it
				connection.query("SELECT * FROM classrooms WHERE memberSocket=?", socket.id, (err, row) => {
					if (err) socket.emit('errorHandle');
					if (row.length) {
						connection.query("SELECT memberSocket FROM classrooms WHERE roomID=? AND teacherIdentity IS NOT NULL", row[0].roomID, (err, teachSocket) => {
							if (err) socket.emit('errorHandle');
							//notify the teacher
							if (teachSocket.length) {
								io.to(teachSocket[0].memberSocket).emit('removeThisStudent', {
									studentID: socket.id,
									inQueue: row[0].queueing,
									studentName: row[0].memberName
								})
								connection.query("DELETE FROM classrooms WHERE memberSocket=?", socket.id, (err) => {
									if (err) socket.emit('errorHandle');
								});
							}
						});
					}
				});
			}
		});
	});
});

server.listen(4209, () => {
	console.log("server go vroom");
});