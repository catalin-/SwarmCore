/**********************************************************************************************
 * Init
 **********************************************************************************************/
var core = require ("../../lib/SwarmCore.js");
core.createAdapter("Launcher");


/**********************************************************************************************
 * Vars
 **********************************************************************************************/
var childForker = require('child_process');
var os = require('os');
var forkOptions;
var adaptorForks = {};
var waitingCount = 0;
var restartCount = {};
var mailMessages = [];
var config, checkInterval, mailInterval;
var isClosing = false;

/**********************************************************************************************
 * Functions
 **********************************************************************************************/
getStatus = function() {
    var adaptors = [];
    for (var key in adaptorForks) {
        adaptors.push(key);
    }
    return {
        systemId: getMyConfig("systemId"),
        nodes: adaptors,
        alive: !isClosing
    }
}

    
    
var MAX_RESTART_LEVEL = 10000;

var mailIntervalTick, forkListenerTick;
(function init() {
    var i, len, adaptorList, localDelay, adapter;

    localDelay = 0;
    config = getMyConfig();

    checkInterval = parseInt(config.checkInterval);
    mailInterval = parseInt(config.mailInterval);

    if (!checkInterval) {
        checkInterval = 2000;
    }
    if (!mailInterval) {
        mailInterval = 61000;
    }

    forkOptions = {
        cwd: process.cwd(),
        env: process.env
    };

    adaptorList = config.autorun;

    for (i = 0; len = adaptorList.length, i < len; i++) {
        adapter = adaptorList[i];
        if (adapter.node.indexOf('Core.js') != -1) {
            //TODO : set to 10 seconds or more
            localDelay = 1000;
            break;
        }
    }

    for (i = 0; len = adaptorList.length, i < len; i++) {
        adapter = adaptorList[i];
        if (adapter.node.indexOf('Core.js') == -1) {
            if (adapter.wait == undefined) {
                adapter.wait = 0;
            }
            adapter.wait += localDelay;
        }
    }

    for (i = 0; len = adaptorList.length, i < len; i++) {
        createAdaptor(adaptorList[i]);
    }

    setTimeout(function () {
        //startSwarm('ping.js', 'dispatch', [getStatus()]);
        forkListenerTick = setInterval(function () {
            listenForks();
        }, checkInterval);
        listenForks();
    }, 2000);

    mailIntervalTick = setInterval(function () {
        sendMessages();
    }, mailInterval);

})();

function cleanUp() {
    clearInterval(forkListenerTick);
    clearInterval(mailIntervalTick);
}
function createAdaptor(adaptorConfig) {
    var instanceCount;
    if (adaptorConfig.node == undefined) {
        logErr("Wrong adapter configuration: no \"node\" property where required when starting auto loading \n");
    }
    if (adaptorConfig.enabled == undefined || adaptorConfig.enabled == true) {
        instanceCount = adaptorConfig.times;
        if (instanceCount == undefined) {
            instanceCount = 1;
        }
        if (adaptorConfig.wait == undefined) {
            runAll(adaptorConfig, instanceCount);
        }
        else {
            setTimeout(bindClosure(adaptorConfig, instanceCount), adaptorConfig.wait);
        }
    }
}

function runAll(adaptorConfig, instanceCount) {
    var i, fork;
    for (i = 0; i < instanceCount; i++) {
        fork = createFork(adaptorConfig, i, instanceCount);
        adaptorForks[fork.name] = fork;
    }
}

function createFork(adaptorConfig, index, maxIndex) {
    var fork;
    var swarmPath = adaptorConfig.node;
    fork = childForker.fork(getSwarmFilePath(swarmPath), null, forkOptions);
    fork.name = swarmPath.substring(swarmPath.lastIndexOf('/') + 1, swarmPath.length - 3);
    fork.index = index;
    fork.maxIndex = maxIndex;
    fork.config = adaptorConfig;
    fork.alive = false;
    fork.messages = [];
    if (index) {
        fork.name = '[' + index + '] ' + fork.name;
    }
    return fork;
}

function killFork(fork) {
    try {
        fork.disconnect();
        fork.kill('SIGINT');
        /*var isAlive = !fork.killed ? "alive" : "dead";
        console.log('Kill process ' + fork.pid + ' | status = ' + isAlive);
        console.log(fork);*/
    } catch (err) {
        console.log(err);
    }
}

function restartFork(fork) {
    killFork(fork);
    fork = createFork(fork.config, fork.index, fork.maxIndex);
    adaptorForks[fork.name] = fork;
    return fork;
}

function bindClosure(adaptorConfig, instanceCount) {
    return function () {
        runAll(adaptorConfig, instanceCount);
    }
}



function listenForks() {
    var key;
    checkedForks = 0;
    for (key  in adaptorForks) {
        tryConnectionToFork(adaptorForks[key], checkForksState);
    }
}


function tryConnectionToFork(adaptorFork, doneCallback) {
    try {
        waitingCount++;
        adaptorFork.removeAllListeners();
        adaptorFork.on('message', function (data) {
            adaptorFork.alive = true;
            restartCount[adaptorFork.name] = 0;
            //console.log(adaptorFork.name + " " + JSON.stringify(data));
            if (!data.ok) {
                adaptorFork.messages.push(data);
            }
        });
        adaptorFork.send({data: 'Are you ok?'});
    }
    catch (err) {
        adaptorFork.alive = false;
    }

    setTimeout(function () {
        waitingCount--;
        if (!waitingCount) {
            doneCallback();
        }
    }, config.messageTimeout);
}


function checkForksState() {
    //check if Launcher is closing
    /*var ss = isClosing ? "closing" : "alive";
    console.log("Check for state - " + ss);*/
    if (isClosing) {
        return;
    }
    
    var fork, lastMessage, key, i, len;
    var forRestart = [];

    for (key  in adaptorForks) {
        lastMessage = null;
        fork = adaptorForks[key];

        if (fork.messages.length) {
            lastMessage = fork.messages[fork.messages.length - 1];
        }

        if (!fork.alive) {
            fork.restartDetails = "Not alive.";
            forRestart.push(fork);
            continue;
        }

        if (lastMessage && !lastMessage.ok) {
            if (lastMessage.requireRestart) {
                fork.restartDetails = "Restart required.Details :" + lastMessage.details + ".";
                forRestart.push(fork);
                continue;
            }
        }
    }

    if (forRestart.length) {
        for (i = 0; len = forRestart.length, i < len; i++) {
            fork = forRestart[i];
            if (!restartCount[fork.name]) {
                restartCount[fork.name] = 0;
            }
            restartCount[fork.name] = restartCount[fork.name] + 1;

            if (restartCount[fork.name] < MAX_RESTART_LEVEL) {
                logEvent(fork.name + " need restart[" + restartCount[fork.name] + "]." + fork.restartDetails);
                restartFork(fork);
            }
            else {
                killFork(fork);
                adaptorForks[fork.name] = null;
                delete adaptorForks[fork.name];
                logEvent(fork.name + " restarted " + MAX_RESTART_LEVEL + " times We stop the process as probably is something very wrong.");
            }
        }
    }
}


function logEvent(event) {
    var now = new Date();
    mailMessages.push(now.toDateString() + "  -  " + event);
    logErr(event);
}


function sendMessages() {
    if (!mailMessages.length) {
        return;
    }
    var coreId = getMyConfig("Core").coreId;
    var time = new Date();
    var now = time.getDate() + "-" + (time.getMonth() + 1) + "," + time.getHours() + ":" + time.getMinutes();
    var message = "Message generated at " + now + " [" + coreId + "][" + os.hostname() + "][" + os.type() + "].<br> ";
    message += mailMessages.join("<br>");
    startSwarm("Mailer.js", "sendMail",
        [ coreId + "@nodewatcher.trp.ro"],
        config.errorMails,
        "[" + coreId + "] Some adapters are down.Restart required.", message);
    mailMessages = [];
}

function killAllForks() {
    var fork, key;
    isClosing = true;

    cleanUp();
    startSwarm('ping.js', 'dispatch', [getStatus()]);
    try {
        for (key  in adaptorForks) {
            fork = adaptorForks[key];
            delete adaptorForks[key];
            killFork(fork);
        }

    } catch (e) {
        console.log(e);
    }

    setTimeout(function () {
        //just kill it for now
        process.exit();
    }, 3000);

}

process.on('exit', function () {
    //logErr('Launcher exit.');
    console.log('Got close for process ' + process.pid);
    killAllForks();
});

process.on('SIGTERM', function () {
    //logErr('Got SIGTERM.');
    console.log('Got SIGTERM for process ' + process.pid);
    killAllForks();
});

process.on('SIGHUP', function () {
    //logErr('Got SIGHUP.');
    console.log('Got SIGHUP for process ' + process.pid);
    killAllForks();
});

process.on('SIGINT', function () {
    //logErr('Got SIGINT.');
    console.log('Got SIGINT for process ' + process.pid);
    killAllForks();
});

//hackintosh  
process.on("uncaughtException", function (error) {
    if (error.toString() !== 'Error: IPC channel is already disconnected') {
        process.stderr.write(error.stack);
        process.exit(1);
    }
}); 
