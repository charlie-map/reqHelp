const socket = io.connect("/");

function hideAll() {
	$("#homePageTeach").hide();
	$("#errorPage").hide();
	$("#gettingStartedTeach").hide();
	$("#gettingStartedStudent").hide();
	$("#startedClassTeach").hide();
	$("#studentInTeachersRoom").hide();
	$("#teacherRoomNotExistent").hide();
}

hideAll();

$("#goTeach").click(() => {
	window.sessionStorage.setItem('teacherClassOptionsStillThere', false);
	$("#teachOrStudent").hide();
	$("#gettingStartedTeach").show();
	$("#signup").hide();
	$("#bigCircle").css("width", $("#buttonSignupInstead").width() + 12);
});

$("#goStudy").click(() => {
	$("#teachOrStudent").hide();
	$("#gettingStartedTeach").hide();
	$("#gettingStartedStudent").show();
});

$("#buttonSignupInstead").click(() => {
	$("#signup").toggle();
	$("#login").toggle();
});

socket.on('authCheckForDis', () => {
	if (window.sessionStorage.getItem('token') &&
		typeof window.sessionStorage.getItem('username') != "undefined") {
		socket.emit('authCheckForDisTrue', {
			token: window.sessionStorage.getItem('token'),
			username: window.sessionStorage.getItem('username')
		});
	}
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
	$("#teachOrStudent").show();
});

socket.on('usernameNotExist', () => {
	alert("This username does not exist");
});

socket.on('incorrectPassword', () => {
	alert("This password is incorrect");
});

socket.on('fixInformation', (serverInfo) => {
	window.sessionStorage.setItem('token', serverInfo.token);
});

socket.on('toTable', (serverInfo) => {
	hideAll();
	$("#teachOrStudent").hide();
	if (serverInfo.token != null) {
		window.sessionStorage.setItem('token', serverInfo.token);
		window.sessionStorage.setItem('username', serverInfo.username);
		window.sessionStorage.setItem('teachname', serverInfo.teachname);
		window.sessionStorage.setItem('teachRoomCode', serverInfo.yourRoomCode);
		window.sessionStorage.setItem('teacherTimeout', serverInfo.teacherTimeout);
		$("#teacherClassLength").text("Inactivity timeout: " + window.sessionStorage.getItem('teacherTimeout') + " minutes");
		$("#teacherTrueName").text(window.sessionStorage.getItem('teachname'));
		$("#gettingStartedTeach").hide();
		$("#homePageTeach").show();
		$(".settingsPage").hide();
		$("#confirmSettingChanges").hide();
		$("#teacherClassOptions").hide();
	} else {
		window.sessionStorage.setItem('teachname', serverInfo.teachname);
	}
});

$("#settingsPage").click(function() {
	$(".settingsPage").toggle();
	$("#teacherStartClass").toggle();
	if ($(".settingsPage").is(":visible") && $("#teacherClassOptions").is(":visible")) {
		window.sessionStorage.setItem('teacherClassOptionsStillThere', true);
		$("#teacherClassOptions").hide();
	} else if (!$(".settingsPage").is(":visible") && window.sessionStorage.getItem('teacherClassOptionsStillThere') == "true") {
		$("#teacherClassOptions").show();
	} else {
		window.sessionStorage.setItem('teacherClassOptionsStillThere', false);
	}
	setTimeout(hideSettingsCheck, 300);
});

$("#nameChange").keypress(event => {
	$("#confirmSettingChanges").show();
});

$("#meetTimeout").keypress(event => {
	$("#confirmSettinChanges").show();
});

function hideSettingsCheck() {
	($("#nameChange").val() != "" || $("#meetTimeout").val() != "") ? $("#confirmSettingChanges").show(): $("#confirmSettingChanges").hide();
	if ($(".settingsPage").is(":visible")) setTimeout(hideSettingsCheck, 300);
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
	if (window.sessionStorage.getItem('teacherClassOptionsStillThere') == "true") {
		$("#teacherClassOptions").show();
	}
	if ($("#nameChange").val() != "") {
		socket.emit('newTeacherDisplayName', {
			name: $("#nameChange").val(),
			token: window.sessionStorage.getItem('token'),
			username: window.sessionStorage.getItem('username')
		});
		window.sessionStorage.setItem('teachname', $("#nameChange").val());
		$("#teacherTrueName").text(window.sessionStorage.getItem('teachname'));
		$("#nameChange").val("");
	}
	if ($("#meetTimeout").val() != "") {
		let string = $("#meetTimeout").val();
		$("#meetTimeout").val("");
		let num = parseInt(string.replace(/\D/g, ''), 10);
		num = num > 240 ? 240 : num;
		window.sessionStorage.setItem('teacherTimeout', num);
		$("#teacherClassLength").text("Inactivity timeout: " + num + " minutes");
		socket.emit('newTeacherTimeoutValue', {
			value: num,
			token: window.sessionStorage.getItem('token'),
			username: window.sessionStorage.getItem('username')
		});
	}
});

$("#teacherStartClass").click(() => {
	$("#teacherClassOptions").toggle();
});

$("#startClass").click(() => {
	$("#homePageTeach").hide();
	window.sessionStorage.setItem('closedOrOpenRoom', $("#whatHappensToStudent").prop("checked"));
	socket.emit('teacherStartingClass', {
		username: window.sessionStorage.getItem('username'),
		displayName: window.sessionStorage.getItem('teachname'),
		token: window.sessionStorage.getItem('token'),
		newRoomCode: window.sessionStorage.getItem('teachRoomCode'),
		closedRoom: window.sessionStorage.getItem('closedOrOpenRoom')
	});
});

socket.on('cleanTeacherRoomStart', (serverInfo) => {
	let students = $("#studentListinClass li");
	if (students.length > 1) {
		students.each(function(index, li) {
			let item = $(this).attr("id");
			if (item != "tempname" && index != 0) $("#" + item).remove();
		});
	}
	$("#startedClassTeach").show();
	$("#currentStudentQueue").hide();
	window.sessionStorage.getItem('closedOrOpenRoom') == "true" ? $("#currentStudentQueueOpen").show() : $("#currentStudentQueueOpen").hide();
	$("#teachersClass").text(window.sessionStorage.getItem('teachname') + "'s room");
	$(".badge1").attr("data-badge", serverInfo.queueLength);
	window.sessionStorage.setItem('queueLength', serverInfo.queueLength);
	if ($(".badge1").attr("data-badge") == 0) {
		$(".badge1").removeAttr("data-badge");
	}
	$("#teachersRoomID").text("Room code - " + window.sessionStorage.getItem('teachRoomCode'));
});

socket.on('studentHasJoinedTheRoomQueue', (serverInfo) => {
	$(".badge1").attr("data-badge", serverInfo.queueLength);
	window.sessionStorage.setItem('queueLength', serverInfo.queueLength);
	$("#noStudentsCurrently").hide();
	$("#studentListinQueue").append(
		"<li class='" + serverInfo.name + "' id='" + serverInfo.studentSocket + "position'> <span  id='" + serverInfo.studentSocket + "'>" + serverInfo.name + "</span> " +
		"<br> <button class='accepting' id='" + serverInfo.studentSocket + "accept'> Allow </button> <button class='denying' id='" + serverInfo.studentSocket + "deny'> Deny </button> </li>"
	);
});

$("#currentStudentQueueOpen").click(() => {
	parseInt(window.sessionStorage.getItem('queueLength'), 10) > 0 ? $("#noStudentsCurrently").hide() : $("#noStudentsCurrently").show();
	$("#currentStudentQueue").toggle();
});

$("#closeQueuePage").click(() => {
	$("#currentStudentQueue").hide();
});

$(document).on('click', '.accepting', function() {
	let studentID = $(this).attr("id").substring(0, 20) + "position";
	let studentName = $("#" + studentID).attr("class");
	window.sessionStorage.setItem('queueLength', parseInt(window.sessionStorage.getItem('queueLength'), 10) - 1);
	if (parseInt(window.sessionStorage.getItem('queueLength'), 10) == 0 || isNaN(parseInt(window.sessionStorage.getItem('queueLength'), 10))) {
		$(".badge1").removeAttr("data-badge");
		$("#noStudentsCurrently").show();
	} else {
		$(".badge1").attr("data-badge", window.sessionStorage.getItem('queueLength'));
	}
	$("#" + studentID).remove();
	studentID = studentID.substring(0, 20);
	$("#studentListinClass").append(
		"<li class='allStudentsinRoom' id='" + studentID + "inclass'> <span id='" + studentName + "'>" + studentName +
		"</span> <button class='kickStudentFromClass' id='" + studentID + "kick'> Kick student </button> <button class='helpedStudent' id='" + studentID + "help'> Helped </button></li>"
	);
	$("#" + studentID + "help").hide();
	socket.emit('studentCanJoinTeacherRoom', {
		studentName: studentName,
		studentID: studentID,
		token: window.sessionStorage.getItem('token'),
		teacherName: window.sessionStorage.getItem('teachname'),
		username: window.sessionStorage.getItem('username')
	});
});

$(document).on('click', '.kickStudentFromClass', function() {
	let studentID = $(this).attr("id").substring(0, 20) + "inclass";
	let studentName = $(studentID + " span").val();
	$("#" + studentID).remove();
	studentID = studentID.substring(0, 20);
	socket.emit('studentKickedFromRoom', {
		studentName: studentName,
		studentID: studentID,
		token: window.sessionStorage.getItem('token'),
		teachRoomCode: window.sessionStorage.getItem('teachRoomCode'),
		closedOrOpen: window.sessionStorage.getItem('closedOrOpenRoom'),
		teacherName: window.sessionStorage.getItem('teachname'),
		username: window.sessionStorage.getItem('username')
	});
});

socket.on('removeThisStudent', (serverInfo) => {
	if (serverInfo.inQueue) {
		$("#" + serverInfo.studentID + "position").remove();
	} else {
		$("#" + serverInfo.studentID + "inclass").remove();
	}
});

$(document).on('click', '.denying', function() {
	let studentID = $(this).attr("id").substring(0, 20) + "position";
	let studentName = $("#" + studentID + " span").val();
	$("#" + studentID).remove();
	studentID = studentID.substring(0, 20);
	window.sessionStorage.setItem('queueLength', parseInt(window.sessionStorage.getItem('queueLength'), 10) - 1);
	parseInt(window.sessionStorage.getItem('queueLength'), 10) == 0 ? ($(".badge1").removeAttr("data-badge"), $("#noStudentsCurrently").show()) : $(".badge1").attr("data-badge", window.sessionStorage.getItem('queueLength'));
	socket.emit('studentKickedFromRoom', {
		studentName: studentName,
		studentID: studentID,
		token: window.sessionStorage.getItem('token'),
		teachRoomCode: window.sessionStorage.getItem('teachRoomCode'),
		closedOrOpen: window.sessionStorage.getItem('closedOrOpenRoom'),
		teacherName: window.sessionStorage.getItem('teachname'),
		username: window.sessionStorage.getItem('username')
	});
});

socket.on('studentHasJoinedTheRoom', (serverInfo) => {
	$("#studentListinClass").append(
		"<li class='allStudentsinRoom' id='" + serverInfo.studentSocket + "inclass'> <span id='" + serverInfo.name + "'>" + serverInfo.name +
		"</span> <button class='kickStudentFromClass' id='" + serverInfo.studentSocket + "kick'> Kick student </button>" +
		"<button class='helpedStudent' id='" + serverInfo.studentSocket + "help'> Helped </button> </li>"
	);
	$("#" + serverInfo.studentSocket + "help").hide();
});

socket.on('studentNeedsHelpFromTeach', (serverInfo) => {
	$("#" + serverInfo.studentSocket + "inclass").remove();
	let students = $("#studentListinClass li");
	if (students.length > 1) {
		let indexReplace = 0,
			run = true;
		students.each(function(index, li) {
			let item = $(this).attr("id");
			if ($("#" + item + " .helpedStudent").is(":hidden") && run) {
				indexReplace = index - 1;
				run = !run;
			} else {
				indexReplace = students.length - 1;
			}
		});
		students.each(function(index, li) {
			if (index == indexReplace) {
				$("#" + $(this).attr("id")).after("<li class='allStudentsinRoom' id='" + serverInfo.studentSocket + "inclass'> <span id='" + serverInfo.studentName +
					"'>" + serverInfo.studentName + "</span> <button class='kickStudentFromClass' id='" + serverInfo.studentSocket +
					"kick'> Kick student </button>" + "<button class='helpedStudent' id='" + serverInfo.studentSocket + "help'> Helped </button> </li>");
			}
		});
	} else {
		$("#studentListinClass").append("<li class='allStudentsinRoom' id='" + serverInfo.studentSocket + "inclass'> <span id='" + serverInfo.studentName +
			"'>" + serverInfo.studentName + "</span> <button class='kickStudentFromClass' id='" + serverInfo.studentSocket +
			"kick'> Kick student </button>" + "<button class='helpedStudent' id='" + serverInfo.studentSocket + "help'> Helped </button> </li>");
	}
	$("#" + serverInfo.studentSocket + " .helpedStudent").show();
});

$(document).on('click', '.helpedStudent', function() {
	$(this).hide();
	let studentID = $(this).attr("id").substring(0, 20);
	let student = $("#" + studentID).remove();
	$("#studentListinClass").append(student);
	socket.emit('studentHasBeenHelped', {
		studentID: studentID
	});
});

$("#endClass").click(() => {
	let students = $("#studentListinClass li");
	if (students.length) {
		students.each(function(index, li) {
			let item = $(this).attr("id");
			$("#" + item).remove();
		});
	}
	socket.emit('closeRoom', {
		roomCode: window.sessionStorage.getItem('teachRoomCode'),
		username: window.sessionStorage.getItem('username'),
		token: window.sessionStorage.getItem('token')
	});
});

socket.on('classHasEnded', () => {
	if (window.sessionStorage.getItem('token')) {
		let students = $("#studentListinClass li");
		if (students.length) {
			students.each(function(index, li) {
				let item = $(this).attr("id");
				$("#" + item).remove();
			});
		}
	}
	location.reload();
});

socket.on('aStudentLeftTheRoom', (serverInfo) => {
	$("#" + serverInfo.studentSocket + "position").remove();
	$("#" + serverInfo.studentSocket + "inclass .allStudentsinRoom").remove();
});

function goingToTeacherRoom() {
	$("#studentInTeachersRoom").show();
	window.sessionStorage.setItem('studentTeacherName', $("#teacherRoomIDJoiner").val());
	window.sessionStorage.setItem('studentName', $("#studentShownName").val());
	socket.emit('studentJoin', {
		name: window.sessionStorage.getItem('studentName'),
		teachID: window.sessionStorage.getItem('studentTeacherName')
	});
}

$("#teacherRoomIDJoiner").keypress(event => {
	let key = event.keyCode;
	if (key == 13) {
		goingToTeacherRoom();
	}
});

$("#goToTeacherRoom").click(() => {
	goingToTeacherRoom();
});

socket.on('teachRoomNoExist', () => {
	$("#gettingStartedStudent").hide();
	$("#studentCurrentLocation").val(window.sessionStorage.getItem('studentTeacherName'));
	$("#teacherRoomNotExistent").show();
	$("#teacherRoomExist").hide();
});

socket.on('teacherRoomJoined', (serverInfo) => {
	$("#waitingForHelpFromTeach").hide();
	$("#gettingStartedStudent").hide();
	$("#teacherRoomExist").show();
	$("#teacherRoomNotExistent").hide();
	window.sessionStorage.setItem('inOrOutOfRoom', serverInfo.queueOrJoin);
	if (serverInfo.queueOrJoin == "1") {
		$("#teacherNameForRoom1").text(serverInfo.teacherName + "'s queue");
		$("#joinedRoomQueue").show();
		$("#fullyJoined").hide();
		$("#joiningTeachersRoomInABit").show();
	} else {
		$("#joiningTeachersRoomInABit1").hide();
		$("#joiningTeachersRoomInABit").hide();
		$("#teacherNameForRoom1").hide();
		$("#teacherNameForRoom").text(serverInfo.teacherName + "'s room");
		$("#fullyJoined").show();
	}
});

socket.on('trueJoinTeacherRoom', (serverInfo) => {
	$("#joinedRoomQueue").hide();
	$("#teacherNameForRoom1").hide();
	$("#teacherNameForRoom").text(serverInfo.teacherName + "'s room");
	$("#fullyJoined").show();
	$("#joiningTeachersRoomInABit1").hide();
	$("#joiningTeachersRoomInABit").hide();
});

$("#requestHelpFromTeacher").click(() => {
	$("#requestHelpFromTeacher").hide();
	$("#waitingForHelpFromTeach").show();
	$("#joiningTeachersRoomInABit1").show();
	socket.emit('thisStudentNeedsHelp', {
		studentName: window.sessionStorage.getItem('studentName'),
		currentRoom: window.sessionStorage.getItem('studentTeacherName')
	});
	socket.on('teacherHasHelpedYou', () => {
		$("#requestHelpFromTeacher").show();
		$("#waitingForHelpFromTeach").hide();
		$("#joiningTeachersRoomInABit1").hide();
	});
});

socket.on('studentGotKickedFromRoom', (serverInfo) => {
	hideAll();
	$("#studentGotKicked").text("You were not allowed into " + serverInfo.teacherRoom + "'s room");
});

function done() {
	location.reload();
}

socket.on('errorHandle', (serverInfo) => {
	hideAll();
	$("#errorPage").show();
	$("#errorPage span").text("We'll redirect in a second");
	setTimeout(done, 5000);
});