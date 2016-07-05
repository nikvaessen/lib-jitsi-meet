import JitsiTrack from '../RTC/JitsiTrack';
import 

/**
 * Converts JitsiTracks with mediatype audio into text format
 *
 * @constructor the local audiotrack
 */
function Converter(localtrack) {
    //array holding all the JitsiTracks
    this.audioTracks = [];

    this.attachAudioTrack(localtrack);

}

Converter.prototype.attachAudioTrack = function (audioTrack) {
    if(audioTrack == JitsiTrack && audioTrack.isAudioTrack())
    {
        this.audioTracks.push(audioTrack);
        return true;
    }
    console.debug("Cannot attach JitsiTrack to the converter, wrong object given");
    return false
};

Converter.prototype.checkOnTracks = function () {
    for(var track in this.audioTracks)
    {
        var stream = track.getOriginalStream();
        stream
    }
};


