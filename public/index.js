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
	$("#bigCircle").css("width", $("#buttonSignupInstead").width() + 12);
});

$("#goStudy").click(() => {
	$("#teachOrStudent").hide();
	$("#gettingStartedStudent").show();
});

$("#buttonSignupInstead").click(() => {
	$("#signup").toggle();
	$("#login").toggle();
});

function signUp() {
	socket.emit('signUp', {
		username: $("#usernameS").val(),
		password: $("#passwordS").val()
	});
	sessionStorage.setItem("username", $("#usernameS").val());
	$("#usernameS").val("");
	$("#passwordS").val("");
}

$("#buttonSignup").click(function() {
	signUp();
});

$("#passwordS").keypress(event => {
	let key = event.keyCode;
	if (key == 13) {
		signUp();
	}
});

$("#buttonLoginInstead").click(() => {
	$("#signup").toggle();
	$("#login").toggle();
});

function login() {
	socket.emit('login', {
		username: $("#usernameL").val(),
		password: $("#passwordL").val()
	});
	sessionStorage.setItem("username", $("#usernameL").val());
	$("#usernameL").val("");
	$("#passwordL").val("");
}

$("#buttonLogin").click(function() {
	login();
});

$("#passwordL").keypress(event => {
	let key = event.keyCode;
	if (key == 13) {
		login();
	}
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
	if (serverInfo.token != null) {
		window.sessionStorage.setItem('token', serverInfo.token);
		window.sessionStorage.setItem('username', serverInfo.username);
		window.sessionStorage.setItem('teachname', serverInfo.teachname);
		window.sessionStorage.setItem('teachRoomCode', serverInfo.yourRoomCode);
		//"reload" the page
		$("#gettingStartedTeach").hide();
		$("#homePageTeach").show();
		$(".settingsPage").hide();
		$("#confirmSettingChanges").hide();
		$("#teacherClassOptions").hide();
	} else {
		window.sessionStorage.setItem('teachname', serverInfo.teachname);
	}
	$("#teacherTrueName").text(window.sessionStorage.getItem('teachname'));
});

$("#settingsPage").click(function() {
	$(".settingsPage").toggle();
	$("#teacherStartClass").toggle();
	//if options are visible and you're pulling open settings, close
	//if options are not visible and you're pulling, nothing
	//need to save current options value when closing if it was open
	if ($(".settingsPage").is(":visible") && $("#teacherClassOptions").is(":visible")) {
		//need to hide it, but restore it when we exit
		window.sessionStorage.setItem('teacherClassOptionsStillThere', true);
		$("#teacherClassOptions").hide();
	} else if ($(".settingsPage").is(":hidden") && window.sessionStorage.getItem('teacherClassOptionsStillThere') == "true") {
		//check to see if the window should be opened
		$("#teacherClassOptions").show();
	} else if ($(".settingsPage").is(":visible") && $("#teacherClassOptions").is(":hidden")) {
		//set teach to false and leave it on that
		window.sessionStorage.setItem('teacherClassOptionsStillThere', false);
	} else {
		window.sessionStorage.setItem('teacherClassOptionsStillThere', false);
	}
	setTimeout(hideSettingsCheck, 300);
});

$("#nameChange").keypress(event => {
	//if any event, enable to confirm button at the bottom of the page
	$("#confirmSettingChanges").show();
});

function hideSettingsCheck() {
	//check to see if the inputs have changed
	$("#nameChange").val() != "" ? $("#confirmSettingChanges").show() : $("#confirmSettingChanges").hide();
	$(".settingsPage").is(":visible") ? setTimeout(hideSettingsCheck, 300) : console.log("don't display");
}

$("#closeSettingsPage").click(function() {
	$(".settingsPage").hide();
	$("#teacherStartClass").show();
	if (window.sessionStorage.getItem('teacherClassOptionsStillThere') == "true") {
		$("#teacherClassOptions").show();
	}
});

$("#confirmSettingChanges").click(function() {
	$(".settingsPage").toggle();
	$("#teacherStartClass").toggle();
	$("#confirmSettingChanges").hide();
	//send new teacher name to update the database
	if (window.sessionStorage.getItem('teacherClassOptionsStillThere') == "true") {
		$("#teacherClassOptions").show();
	}
	if ($("#nameChange").val() != "") {
		socket.emit('newTeacherDisplayName', {name: $("#nameChange").val(), token: window.sessionStorage.getItem('token'), username: window.sessionStorage.getItem('username')});
	}
});

$("#teacherStartClass").click(() => {
	$("#teacherClassOptions").toggle();
});

$("#startClass").click(() => {
	$("#homePageTeach").hide();
	window.sessionStorage.setItem('closedOrOpenRoom', $("#whatHappensToStudent").prop("checked"));
	socket.emit('teacherStartingClass', {
		usernameCode: window.sessionStorage.getItem('username'),
		token: window.sessionStorage.getItem('token'),
		newRoomCode: window.sessionStorage.getItem('teachRoomCode'),
		closedOrOpen: window.sessionStorage.getItem('closedOrOpenRoom')
	});
	socket.on('cleanTeacherRoomStart', () => {
		$("#startedClassTeach").show();
		window.sessionStorage.getItem('closedOrOpenRoom') ? ($("#currentStudentQueue").show(), window.sessionStorage.setItem('queueLengt', 0)) : $("#currentStudentQueue").hide();
		$("#teachersClass").text(window.sessionStorage.getItem('teachname') + "'s room");
		$("#teachersRoomID").text("Current room code - " + window.sessionStorage.getItem('teachRoomCode'));
	});
});

socket.on('studentHasJoinedTheRoomQueue', (serverInfo) => {
	//make notification bar show
	window.sessionStorage.setItem('queueLength', window.sessionStorage.getItem('queueLength') + 1);
	$(".badge").val(window.sessionStorage.getItem('queueLength'));
	$("#studentListinQueue").append(
		"<li id='" + serverInfo.name + "'> <span>" + serverInfo.name + "</span> " +
		"<button class='accepting' id='allow'> Allow </button> <button class='denying' id='deny'> Deny </button> </li>"
	);
});

socket.on('studentHasJoinedTheRoom', (serverInfo) => {
	$("#studentListInClass").append(
		"<li> <span>" + serverInfo.name + "</span> </li>"
	);
});

$(".accepting").click(() => {
	//find the id of said button - related to student
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
	socket.on('teacherRoomJoined', (serverInfo) => {
		$("#teacherRoomExist").show();
		$("#teacgerNameForRoom").text(serverInfo.teachername + "'s room");
	});
});