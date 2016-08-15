var JitsiTrack = require("./JitsiTrack");
var JitsiTrackEvents = require("../../JitsiTrackEvents");
var RTCBrowserType = require("./RTCBrowserType");
var Statistics = require("../statistics/statistics");
var AdapterJS = require("./adapter.screenshare");

var ttfmTrackerAudioAttached = false;
var ttfmTrackerVideoAttached = false;

/**
 * Represents a single media track (either audio or video).
 * @param RTC the rtc instance.
 * @param ownerJid the MUC JID of the track owner
 * @param stream WebRTC MediaStream, parent of the track
 * @param track underlying WebRTC MediaStreamTrack for new JitsiRemoteTrack
 * @param mediaType the MediaType of the JitsiRemoteTrack
 * @param videoType the VideoType of the JitsiRemoteTrack
 * @param ssrc the SSRC number of the Media Stream
 * @param muted intial muted state of the JitsiRemoteTrack
 * @constructor
 */
function JitsiRemoteTrack(conference, ownerJid, stream, track, mediaType, videoType,
                          ssrc, muted) {
    JitsiTrack.call(
        this, conference, stream, track, function () {}, mediaType, videoType, ssrc);
    this.conference = conference;
    this.peerjid = ownerJid;
    this.muted = muted;
    // we want to mark whether the track has been ever muted
    // to detect ttfm events for startmuted conferences, as it can significantly
    // increase ttfm values
    this.hasBeenMuted = muted;
}

JitsiRemoteTrack.prototype = Object.create(JitsiTrack.prototype);
JitsiRemoteTrack.prototype.constructor = JitsiRemoteTrack;

/**
 * Sets current muted status and fires an events for the change.
 * @param value the muted status.
 */
JitsiRemoteTrack.prototype.setMute = function (value) {
    if(this.muted === value)
        return;

    if(value)
        this.hasBeenMuted = true;

    // we can have a fake video stream
    if(this.stream)
        this.stream.muted = value;

    this.muted = value;
    this.eventEmitter.emit(JitsiTrackEvents.TRACK_MUTE_CHANGED);
};

/**
 * Returns the current muted status of the track.
 * @returns {boolean|*|JitsiRemoteTrack.muted} <tt>true</tt> if the track is
 * muted and <tt>false</tt> otherwise.
 */
JitsiRemoteTrack.prototype.isMuted = function () {
    return this.muted;
};

/**
 * Returns the participant id which owns the track.
 * @returns {string} the id of the participants.
 */
JitsiRemoteTrack.prototype.getParticipantId = function() {
    return Strophe.getResourceFromJid(this.peerjid);
};

/**
 * Returns the participant name which owns the track.
 * @returns {string} the name of the participants.
 */
JitsiRemoteTrack.prototype.getParticipant = function() {
    return Strophe.getResourceFromJid(this.peerjid).getDisplayName();
};

/**
 * Return false;
 */
JitsiRemoteTrack.prototype.isLocal = function () {
    return false;
};

/**
 * Returns the synchronization source identifier (SSRC) of this remote track.
 * @returns {string} the SSRC of this remote track
 */
JitsiRemoteTrack.prototype.getSSRC = function () {
    return this.ssrc;
};

/**
 * Changes the video type of the track
 * @param type the new video type("camera", "desktop")
 */
JitsiRemoteTrack.prototype._setVideoType = function (type) {
    if(this.videoType === type)
        return;
    this.videoType = type;
    this.eventEmitter.emit(JitsiTrackEvents.TRACK_VIDEOTYPE_CHANGED, type);
};

JitsiRemoteTrack.prototype._playCallback = function () {
    var type = (this.isVideoTrack() ? 'video' : 'audio');

    var now = window.performance.now();
    console.log("(TIME) Render " + type + ":\t", now);
    this.conference.getConnectionTimes()[type + ".render"] = now;

    var ttfm = now
        - (this.conference.getConnectionTimes()["session.initiate"]
        - this.conference.getConnectionTimes()["muc.joined"])
        - (window.connectionTimes["obtainPermissions.end"]
        - window.connectionTimes["obtainPermissions.start"]);
    this.conference.getConnectionTimes()[type + ".ttfm"] = ttfm;
    console.log("(TIME) TTFM " + type + ":\t", ttfm);
    var eventName = type +'.ttfm';
    if(this.hasBeenMuted)
        eventName += '.muted';
    Statistics.analytics.sendEvent(eventName, ttfm);
};

/**
 * Attach time to first media tracker only if there is conference and only
 * for the first element.
 * @param container the HTML container which can be 'video' or 'audio' element.
 *        It can also be 'object' element if Temasys plugin is in use and this
 *        method has been called previously on video or audio HTML element.
 * @private
 */
JitsiRemoteTrack.prototype._attachTTFMTracker = function (container) {
    if((ttfmTrackerAudioAttached && this.isAudioTrack())
        || (ttfmTrackerVideoAttached && this.isVideoTrack()))
        return;

    if (this.isAudioTrack())
        ttfmTrackerAudioAttached = true;
    if (this.isVideoTrack())
        ttfmTrackerVideoAttached = true;

    if (RTCBrowserType.isTemasysPluginUsed()) {
        // FIXME: this is not working for IE11
        AdapterJS.addEvent(container, 'play', this._playCallback.bind(this));
    }
    else {
        container.addEventListener("canplay", this._playCallback.bind(this));
    }
};

module.exports = JitsiRemoteTrack;
