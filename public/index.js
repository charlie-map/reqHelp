const socket = io.connect("/");

function hideAll() {
	$("#homePageTeach").hide();
	$("#gettingStartedTeach").hide();
	$("#gettingStartedStudent").hide();
	$("#startedClassTeach").hide();
}

hideAll();

$("#goTeach").click(() => {
	$("#teachOrStudent").hide();
	$("#gettingStartedTeach").show();
	$("#signup").hide();
});

$("#goStudy").click(() => {
	$("#teachOrStudent").hide();
	$("#gettingStartedStudent").show();
});

$("#buttonSignupInstead").click(() => {
	$("#signup").toggle();
	$("#login").toggle();
});

$("#signupForm").submit(function(event) {
	socket.emit('signUp', {
		username: $("#usernameS").val(),
		password: $("#passwordS").val()
	});
	event.preventDefault();
});

$("#buttonLoginInstead").click(() => {
	$("#signup").toggle();
	$("#login").toggle();
});

$("#loginForm").submit(function(event) {
	socket.emit('login', {
		username: $("#usernameL").val(),
		password: $("#passwordL").val()
	});
	sessionStorage.setItem("username", $("#usernameL").val());
	$("#usernameL").val("");
	$("#passwordL").val("");
	event.preventDefault();
});

socket.on('failedAuth', () => {
	hideAll();
	$("#gettingStartedTeach").show();
});

socket.on('usernameNotExist', () => {
	alert("This username does not exist");
});

socket.on('incorrectPassword', () => {
	alert("This password is incorrect");
});

socket.on('toTable', (serverInfo) => {
	//redirect to the home page for specific users (need to send username);
	console.log(serverInfo.yourRoomCode);
	window.sessionStorage.setItem('token', serverInfo.token);
	window.sessionStorage.setItem('username', serverInfo.username);
	window.sessionStorage.setItem('teachname', serverInfo.teachname);
	window.sessionStorage.setItem('teachRoomCode', serverInfo.yourRoomCode);
	//"reload" the page
	$("#gettingStartedTeach").hide();
	$("#teacherTrueName").text(window.sessionStorage.getItem('teachname'));
	$("#homePageTeach").show();
	$("#teacherClassOptions").hide();
	socket.emit('goingHome');
});

$("#teacherStartClass").click(() => {
	$("#teacherClassOptions").show();
});

$("#startClass").click(() => {
	$("#homePageTeach").hide();
	socket.emit('teacherStartingClass', {
		usernameCode: window.sessionStorage.getItem('username'),
		token: window.sessionStorage.getItem('token'),
		newRoomCode: window.sessionStorage.getItem('teachRoomCode')
	});
	socket.on('cleanTeacherRoomStart', () => {
		$("#startedClassTeach").show();
		$("#teachersClass").text(window.sessionStorage.getItem('teachname') + "'s room");
		$("#teachersRoomID").text("Current room code - " + window.sessionStorage.getItem('teachRoomCode'));
	});
});

socket.on('studentHasJoinedTheRoom', (serverInfo)=> {
	console.log(serverInfo.name)
});

$("#goToTeacherRoom").click(() => {
	//need to send the student name and teacher room the server;
	//first check if the room is online then need to see if it's closed or not
	window.sessionStorage.setItem('studentTeacherName', $("#teacherRoomIDJoiner").val());
	socket.emit('studentJoin', {
		name: $("#studentShownName").val(),
		teachID: window.sessionStorage.getItem('studentTeacherName')
	});
	socket.on('teachRoomNoExist', () => {
		$("#gettingStartedStudent").hide();
		$("#studentCurrentLocation").val(window.sessionStorage.getItem('studentTeacherName'));
		$("#teacherRoomExist").hide();
		$("#studentInTeachersRoom").show();
	});
	socket.on('teacherRoomJoined', ()=> {
		console.log("joined room");
	});
});