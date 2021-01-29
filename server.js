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
				if (err) console.log("selection from token with token no work", err);
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

const timeoutCheck = async function(socket) {
	let timeoutChecker = () => {
		return new Promise((reject, resolve) => {
			connection.query("SELECT meetingTimeoutMinutes, meetingTimeoutExpiry FROM teachers WHERE teacherSocket=?", socket, (err, row) => {
				if (err) console.log(err);
				if (row.length) {
					console.log("OKAY INSIDE OF PROMIS", socket, row[0].meetingTimeoutExpiry);
					//compare them with current date
					if (Date.now() - row[0].meetingTimeoutExpiry < row[0].meetingTimeoutMinutes) {
						connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE teacherSocket=?", [Date.now(), socket], (err) => {
							if (err) console.log("updating teachers error");
							console.log("WITHIN THE INTTER QUERY");
							resolve(true);
						});
					} else {
						resolve(false);
					}
				} else {
					console.log("things health");
					resolve(false);
				}
			});
		});
	};
	let checked = await timeoutChecker();
	try {
		console.log("CORRECT", checked);
		return checked;
	} catch (error) {
		console.log("AHHHHHHH", error);
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

io.on('connection', socket => {
	socket.emit('authCheckForDis');
	socket.on('authCheckForDisTrue', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("SELECT teachExpireTime, roomID, teacherIdentity, myname FROM teachers WHERE username=?", userInfo.username, (err, row2) => {
				if (err) socket.emit('failedAuth');
				if (row2.length) {
					let token = uuidv4();
					socket.emit('fixInformation', {
						token: token
					});
					connection.query("UPDATE tokens SET token=?, expire=?, userSocket=? WHERE teacherUsername=?", [token, Date.now(), socket.id, userInfo.username], (err) => {
						if (err) console.log("token insertion fail");
						if (Date.now() - row2[0].teachExpireTime < 360000) { // if this is true and at least one person in room, then join the room automatically
							connection.query("UPDATE teachers SET teacherSocket=? WHERE roomID=? AND teacherIdentity=?", [socket.id, row2[0].roomID, row2[0].teacherIdentity], (err) => {
								if (err) console.log("updating teacher socket");
								//either send them to their room or just their table
								connection.query("UPDATE classrooms SET memberSocket=? WHERE roomID=? AND teacherIdentity=?", [socket.id, row2[0].roomID, row2[0].teacherIdentity], (err) => {
									if (err) console.log("updating classroom error");
									connection.query("SELECT * FROM classrooms WHERE roomID=?", row2[0].roomID, (err, allRows) => {
										if (err) console.log("classroom selection for all students check");
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
												if (row.memberSocket != socket.id && row.queueing == 0) {
													socket.emit('studentHasJoinedTheRoom', {
														name: row.memberName,
														studentSocket: row.memberSocket
													});
													//then need to check these students for if they need help currently
													if (row.needHelp) {
														socket.emit('studentNeedsHelpFromTeach', {
															studentSocket: row.memberSocket
														});
													}
												}
											});
											//need to run through each student that's not in queue and send a fake in classroom join call to the teacher - done!
										} else {
											connection.query("UPDATE teachers SET roomOpen=0 WHERE teacherSocket=?", socket.id, (err) => {
												if (err) console.log("UPDATING classrooms queue err");
												socket.emit('toTable', {
													token: token,
													username: userInfo.username,
													teachname: row2[0].myname,
													yourRoomCode: row2[0].roomID
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
			if (err) console.log("selection error");
			if (!row.length && username != "teachers" && username != "tokens" && username != "classrooms") {
				let hashValue = await (bcrypt.hash(userInfo.password, saltRounds, function(err, hash) {
					//put into teachers table
					let teacherID = uuidv4().substring(0, 6),
						teacherFier = uuidv4().substring(0, 6);
					connection.query("INSERT INTO teachers (username, password, roomID, myname, teacherSocket, teacherIdentity) VALUES (?, ?, ?, ?, ?, ?)", [username, hash, teacherID, "teacher", socket.id, teacherFier], (err) => {
						if (err) throw err;
						connection.query("INSERT INTO classrooms (memberName, roomID, memberSocket, queueing, needHelp, teacherIdentity) VALUES (?, ?, ?, 0, 0, ?)", ["teacher", teacherID, socket.id, teacherFier], (err) => {
							if (err) throw err;
							//create token
							let preToken = uuidv4();
							connection.query("INSERT INTO tokens(token, expire, userSocket, teacherUsername) VALUES(?, ?, ?, ?)", [preToken, Date.now(), socket.id, username], (err) => {
								if (err) console.log("token insertion error", err);
								socket.emit('toTable', {
									token: preToken,
									username: username,
									teachname: "teacher",
									yourRoomCode: teacherID
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
					if (err) console.log(err);
					if (row.length) {
						let password = userInfo.password;
						bcrypt.compare(password, row[0].password, function(err, result) {
							if (err) console.log("password err");
							if (!result) {
								resolve('incorrectPassword');
							} else {
								connection.query("DELETE FROM classrooms WHERE roomID=? AND teacherIdentity IS NULL", row[0].roomID, (err) => {
									if (err) console.log("resttting table for teacher erro", err);
									//store teachers new socket.id
									connection.query("UPDATE teachers SET teacherSocket=?, roomOpen=0 WHERE id=?", [socket.id, row[0].id], (err) => {
										if (err) console.log("update teachers err");
										//start a session storage with a token value <-- based on their username? sure why not
										connection.query("UPDATE classrooms SET memberSocket=? WHERE roomID=? AND memberName=?", [socket.id, row[0].roomID, row[0].myname], (err) => {
											if (err) console.log("classrooms update error");
											let preToken = uuidv4();
											connection.query("UPDATE tokens SET token=?, expire=?, userSocket=? WHERE teacherUsername=?", [preToken, Date.now(), socket.id, username], (err) => {
												if (err) console.log("insert to tokens err", err);
												sessionStore.setItem('teacherIDCode', row[0].roomID);
												let myname = row[0].myname;
												!(myname) && (myname = "teacher");
												resolve(['toTable', preToken, myname, row[0].roomID]);
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
					yourRoomCode: logCheck[3]
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
			connection.query("SELECT meetingTimeoutMinutes FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
				if (err) console.log("MEETING TIMEOUT ERROR");
				let expireTime = Date.now() + row[0].meetingTimeoutMinutes * 60000;
				connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE teacherSocket=?", [expireTime, socket.id], (err) => {
					if (err) console.log("UPDATING TEACHERS ERROR");
					socket.join(userInfo.newRoomCode);
					//new plan - just add a students and teachers table that stores all the students
					userInfo.closedRoom = userInfo.closedRoom == "true" ? 1 : 0;
					//need to start time limit for the user's room
					connection.query("UPDATE classrooms SET memberSocket=?, memberName=?, queueing=? WHERE roomID=?", [socket.id, userInfo.displayName, userInfo.closedRoom, userInfo.newRoomCode], (err) => {
						if (err) console.log("insertion into classrooms error");
						connection.query("UPDATE teachers SET roomOpen=1 WHERE teacherSocket=?", socket.id, (err) => {
							if (err) console.log("updating tweachers err");
							socket.emit('cleanTeacherRoomStart', {
								roomQueue: 0
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
				if (err) console.log("updating tokens error");
				socket.emit('toTable', {
					teachname: userInfo.name
				})
			});
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('newTeacherTimeoutValue', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("UPDATE TABLE teachers SET meetingTimeoutMinutes=? WHERE teacherSocket=?", [userInfo.value, socket.id], (err) => {
				if (err) console.log("erro on updating teachers");
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
			connection.query("UPDATE classrooms SET queueing=0 WHERE memberSocket=?", userInfo.studentID, (err) => {
				if (err) console.log("updating classrooms, gone wrong");
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
			if (err) console.log("teach socket selection failure");
			if (checkingRow.length && checkingRow[0].roomOpen == 1) {
				connection.query("SELECT queueing FROM classrooms WHERE roomID=? AND memberSocket=?", [userInfo.teachID, checkingRow[0].teacherSocket], (err, closedRoom) => {
					if (err) console.log("selecting queue value for teacher from classroom err");
					//closed room <-- either 0 (open) or 1 (closed)
					connection.query("INSERT INTO classrooms (memberName, needHelp, queueing, memberSocket, roomID) VALUES(?, ?, ?, ?, ?)", [userInfo.name, 0, closedRoom[0].queueing, socket.id, userInfo.teachID], (err, row) => {
						if (err) console.log("selecting room error", err);
						socket.join(userInfo.teachID);
						//notify the main socket only
						connection.query("SELECT teacherSocket, myname FROM teachers WHERE roomID=?", userInfo.teachID, (err, row) => {
							if (err) console.log("teacher socket selection err");
							//based on locked room will decide if the person joins or is put in queue
							//now!
							connection.query("SELECT COUNT(*) AS number FROM classrooms WHERE roomID=? AND queueing=1", userInfo.teachID, (err, queuedRows) => {
								if (err) console.log("error on counting classrooms");
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
		connection.query("SELECT teacherSocket FROM teachers WHERE roomID=?", userInfo.currentRoom, (err, row2) => {
			if (err) console.log("select from teachers roomID err");
			connection.query("SELECT memberName FROM classrooms WHERE roomID=? AND memberSocket=?", [userInfo.currentRoom, row2[0].teacherSocket], (err, checkReal) => {
				if (err) console.log("selecting member name from class with teach socket err");
				if (checkReal.length) {
					connection.query("UPDATE classrooms SET needHelp=1 WHERE memberSocket=?", socket.id, (err) => {
						if (err) console.log("seperate updating classrom");
						io.to(row2[0].teacherSocket).emit('studentNeedsHelpFromTeach', {
							studentSocket: socket.id,
							studentName: userInfo.studentName
						});
						connection.query("UPDATE teachers SET meetingTimeoutExpiry=? WHERE memberSocket=?", [Date.now(), socket.id], (err) => {
							if (err) console.log("updating teach Expiry error in teachs");
						});
					});
				} else {
					socket.emit('teachRoomNoExist');
				}
			});
		});
	});
	socket.on('studentHasBeenHelped', (userInfo) => {
		connection.query("UPDATE classrooms SET needHelp=0 WHERE memberSocket=?", userInfo.studentID, (err) => {
			if (err) console.log("classroom errror 350");
			io.to(userInfo.studentID).emit('teacherHasHelpedYou');
		});
	});
	socket.on('closeRoom', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			connection.query("DELETE FROM classrooms WHERE roomID=? AND teacherIdentity IS NULL", userInfo.roomCode, (err) => {
				if (err) console.log("ending class err");
				socket.emit('classHasEnded');
			});
		}
	});
	socket.on('checkForClosingMeeting', async (userInfo) => {
		let logged = await isLoggedIn(userInfo);
		if (logged) {
			let checked = await timeoutCheck(socket.id);
			console.log(checked);
			if (checked) {
				console.log("no time out");
			} else {
				socket.emit('classHasEnded');
			}
		} else {
			socket.emit('failedAuth');
		}
	});
	socket.on('disconnect', function() {
		connection.query("SELECT username FROM teachers WHERE teacherSocket=?", socket.id, (err, row) => {
			if (err) console.log("teacher for disconnect selection error");
			if (row.length) {
				connection.query("UPDATE teachers SET teachExpireTime=? WHERE username=? AND teacherSocket=?", [Date.now(), row[0].username, socket.id], (err) => {
					if (err) console.log("INSERTION into teachers expiry time error", err);
					//wait to see if there's reconnect within time limit
				});
			} else {
				//delete them from classrooms if they are in it
				connection.query("SELECT * FROM classrooms WHERE memberSocket=?", socket.id, (err, row) => {
					if (err) console.log("count slection for student class");
					if (row.length) {
						connection.query("SELECT memberSocket FROM classrooms WHERE roomID=? AND teacherIdentity IS NOT NULL", row[0].roomID, (err, teachSocket) => {
							if (err) console.log("selection from classrooms for member socket error");
							//notify the teacher
							if (teachSocket.length) {
								io.to(teachSocket[0].memberSocket).emit('removeThisStudent', {
									studentID: socket.id,
									inQueue: row[0].queueing,
									studentName: row[0].memberName
								})
								connection.query("DELETE FROM classrooms WHERE memberSocket=?", socket.id, (err) => {
									if (err) console.log("student deletion from classroom");
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