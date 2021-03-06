
/**
 *  A SwarmingPhase is basically the message, in phase of execution
 * @param swarmingName:
 * @param phase: in what phase
 * @param fromMessage : fromMessage will be cloned here
 * @constructor
 */

//TODO: investigate why fromMessage is not used in onMessageFromQueue
//TODO: use of clone will be better!?

var swarmDSL = require("./SwarmDSL.js");

function SwarmingPhase(swarmingName, phase, fromMessage) {
    if (!swarmDSL.swarmExist(swarmingName)) {
        logErr("No such swarm: " + swarmingName);
        return;
    }
    var swarmObject = swarmDSL.getSwarmDescription(swarmingName);
    var meta = swarmObject.meta;
    var initVars = swarmObject.vars;

    for (var key in swarmObject) {
        var obj = swarmObject[key];
        if (typeof obj === 'function') {
            this[key] = obj.bind(this);
        }
    }

    this.meta = new Object();
    if (meta != undefined) {
        for (var i in meta) {
            this.meta[i] = meta[i];
        }
    }

    if (initVars != undefined) {
        for (var i in initVars) {
            this[i] = initVars[i];
        }
    }

    if (fromMessage != undefined && fromMessage != null) {
        for (var i in fromMessage) {
            if (i != "meta") {
                this[i] = fromMessage[i];
            } else {
                if (fromMessage.meta != undefined) {
                    for (var j in fromMessage.meta) {
                        this.meta[j] = fromMessage.meta[j];
                    }
                }
            }
        }
    }

    this.meta.swarmingName = swarmingName;
    this.meta.currentPhase = phase;
}

SwarmingPhase.prototype.getSwarmName = function () {
    return this.meta.swarmingName;
}


SwarmingPhase.prototype.broadcast = function (phaseName,groupName) {
    if(!groupName){
        var phase = swarmDSL.getSwarmDescription(this.meta.swarmingName)[phaseName];
        if (phase == undefined) {
            logErr("[" + thisAdapter.nodeName + "] " + "Undefined phase " + phaseName + " in swarm " + this.meta.swarmingName);
            return;
        }
        groupName = phase.node;
    }
    var nodes = thisAdapter.nativeMiddleware.getGroupNodes.async(groupName);
    var self = this;
    (function(nodes){
        for(var v in nodes){
            self.swarm(phaseName, v);
        }
    }).swait(nodes);
}

reviveSwarm = function(swarm, phaseName){
    var mySwarm = exports.newSwarmPhase(swarm.meta.swarmingName, phaseName , swarm);
    mySwarm.swarm(phaseName);
}

SwarmingPhase.prototype.swarm = function (phaseName, nodeHint , honeyRequest) {
    var mySwarm = exports.newSwarmPhase(this.meta.swarmingName, phaseName , this);
    mySwarm.meta.honeyRequest = honeyRequest;

    try {
        mySwarm.meta.currentPhase = phaseName;
        var phase = swarmDSL.getSwarmDescription(mySwarm.meta.swarmingName)[phaseName];
        if (!honeyRequest && phase == undefined) {
            logErr("[" + thisAdapter.nodeName + "] " + "Undefined phase " + phaseName + " in swarm " + mySwarm.meta.swarmingName);
            return;
        }

        var swarmTarget = nodeHint;
        if (nodeHint == undefined) {
            swarmTarget = phase.node;
        }

        if(!honeyRequest){
            if(phase["transaction"]){
                mySwarm.meta.currentStage = "transaction";
            } else if(phase["do"]){
                mySwarm.meta.currentStage = "do";
            } else {
                mySwarm.meta.currentStage = "code";
            }

        }

        if (mySwarm.meta.debug == true) {
            dprint("Starting swarm " + this.meta.swarmingName + " towards " + swarmTarget + ", Phase: " + phaseName);
        }

        thisAdapter.nativeMiddleware.setSwarmTarget(mySwarm,swarmTarget);

        mySwarm.meta.phaseIdentity  = thisAdapter.nativeMiddleware.createPhaseIdentity(mySwarm);

        if (swarmTarget != undefined) {
            newPendingSwarm(mySwarm);
        }
        else {
            logInfo("Wrong phase destination: " + phaseName);
        }
    }
    catch (err) {
        logErr("Unknown error in phase {" + phaseName + "} nodeHint is {" + targetNodeName + "} Dump: " + J(swarmDSL.getSwarmDescription(mySwarm.swarmingName)), err);
    }
};

SwarmingPhase.prototype.honey = function (phase) {
    this.swarm(phase, this.getEntryAdapter(), true);
}

SwarmingPhase.prototype.toUser = function (userName, phaseName, errorSwarm,errorSwarmPhaseName ) {
    startSwarm("VisitUser.js", "response", userName, this, phaseName, errorSwarm,errorSwarmPhaseName);
}

SwarmingPhase.prototype.home = SwarmingPhase.prototype.honey;

SwarmingPhase.prototype.timeoutSwarm = function (timeOut, phaseName, nodeHint) {
    var timeoutId = -1;
    try {
        var targetNodeName = nodeHint;
        if (nodeHint == undefined) {
            targetNodeName = swarmDSL.getSwarmDescription(this.swarmingName)[phaseName].node;
        }
        if (nodeHint == thisAdapter.nodeName) {
            var callBack = swarmDSL.getSwarmDescription(this.swarmingName)[phaseName].code;
            if (typeof callBack == "function") {
                timeoutId = setTimeout(callBack.bind(this), timeOut);
            } else {
                logErr("Failed in setting timeout in swarm " + this.meta.swarmingName + " because " + phaseName + " is not a phase", err);
            }
        } else {
            timeoutId = setTimeout(function () {
                this.swarm(phaseName, nodeHint);
            }.bind(this), timeOut);
        }
    }
    catch (err) {
        logErr("Failed in setting timeout in swarm " + this.swarmingName, err);
    }
    return timeoutId;
}

exports.newSwarmPhase = function (swarmingName, phase, model) {
    return new SwarmingPhase(swarmingName, phase, model);
}

SwarmingPhase.prototype.currentSession = function () {
    return this.meta.sessionId;
}

SwarmingPhase.prototype.failExecution = function (error) {
    this.meta.failed = true;
    this.meta.failCause = error;
    dprint("Execution failed " + M(this));
}


SwarmingPhase.prototype.getEntryAdapter = function () {
    return this.meta.entryAdapter;
}

SwarmingPhase.prototype.getSessionId = SwarmingPhase.prototype.currentSession;

SwarmingPhase.prototype.setSessionId = function (session) {
    this.meta.sessionId = session;
}


SwarmingPhase.prototype.getTenantId = function () {
    return this.meta.tenantId;
}

SwarmingPhase.prototype.getUserId = function () {
    return this.meta.userId;
}


SwarmingPhase.prototype.hasRole = function (roleName) {
    return this.meta.userRoles.indexOf(roleName) != -1;
}

SwarmingPhase.prototype.setTenantId = function (tenant) {
    throw new Error("not implemented"); //failure
    //this.meta.tenantId = tenant;
    //beginExecutionContext(this);
}

