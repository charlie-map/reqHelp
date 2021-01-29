DROP DATABASE IF EXISTS helper;
CREATE DATABASE helper;

USE helper;

CREATE TABLE teachers {
	id INT NOT NULL AUTO_INCREMENT,
	username VARCHAR(255) NOT NULL,
	password VARCHAR(60) NOT NULL,
	roomID CHAR(6),
	myname VARCHAR(255),
	teacherSocket CHAR(20),
	teachExpireSocket BIGINT,
	teacherIdentity CHAR(6),
	roomOpen TINYINT(1),
	meetingTimeoutMinutes CHAR(3) DEFAULT 30,
	meetingTimeoutExpiry BIGINT,
	PRIMARY KEY(id)
}

CREATE TABLE tokens {
	id INT NOT NULL AUTO_INCREMENT,
	token CHAR(36) NOT NULL,
	expire BIGINT,
	userSocket CHAR(20),
	teacherUsername VARCHAR(255)
}

CREATE TABLE classrooms {
	id INT NOT NULL AUTO_INCREMENT,
	roomID CHAR(6) NOT NULL,
	memberSocket CHAR(6) NOT NULL,
	memberName VARCHAR(255),
	queueing TINYINT(1) NOT NULL,
	needHelp TINYINT(1) NOT NULL,
	teacherIdentity CHAR(6),
	PRIMARY KEY(id)
}