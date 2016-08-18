var audioRecorder = require( './audioRecorder');
var SphinxService = require(
    './transcriptionServices/SphinxTranscriptionService');

var BEFORE_STATE = "before";
var RECORDING_STATE = "recording";
var TRANSCRIBING_STATE = "transcribing";
var FINISHED_STATE = "finished";

//the amount of characters each line in the transcription will have
var MAXIMUM_SENTENCE_LENGTH = 80;

/**
 * This is the main object for handing the Transcription. It interacts with
 * the audioRecorder to record every person in a conference and sends the
 * recorder audio to a transcriptionService. The returned speech-to-text result
 * will be merged to create a transcript
 */
var transcriber =  {
    //the object which can record all audio in the conference
    audioRecorder: audioRecorder,
    //this object can send the recorder audio to a speech-to-text service
    transcriptionService: new SphinxService(),
    //holds a counter to keep track if merging can start
    counter: null,
    //holds the date when transcription started which makes it possible
    //to calculate the offset between recordings
    startTime: null,
    //will hold the transcription once it is completed
    transcription: null,
    //this will be a method which will be called once the transcription is done
    //with the transcription as parameter
    callback: null,
    //stores all the retrieved speech-to-text results to merge together
    //this value will store an Array<Word> object
    results: []
};

/**
 * Stores the current state of the transcription process
 * @type {string}
 */
var state = BEFORE_STATE;

/**
 * Method to start the transcription process. It will tell the audioRecorder
 * to start storing all audio streams and record the start time for merging
 * purposes
 */
transcriber.start = function start() {
    if(state !== BEFORE_STATE){
        throw new Error("The transcription can only start when it's in the" +
            "\"" + BEFORE_STATE + "\" state. It's currently in the " +
            "\"" + state + "\" state");
    }
    state = RECORDING_STATE;
    audioRecorder.start();
    transcriber.startTime = new Date();
};

/**
 * Method to stop the transcription process. It will tell the audioRecorder to
 * stop, and get all the recorded audio to send it to the transcription service

 * @param callback a callback which will receive the transcription
 */
transcriber.stop = function stop(callback) {
    if(state !== RECORDING_STATE){
        throw new Error("The transcription can only stop when it's in the" +
            "\"" + RECORDING_STATE + "\" state. It's currently in the " +
            "\"" + state + "\" state");
    }
    console.log("stopping recording and sending audio files");
    audioRecorder.stop();
    audioRecorder.getRecordingResults().forEach(function(recordingResult){
        transcriber.transcriptionService.send(recordingResult, blobCallBack);
        transcriber.counter++;
    });
    //set the state to "transcribing" so that maybeMerge() functions correctly
    state = TRANSCRIBING_STATE;
    //and store the callback for later
    transcriber.callback = callback;
};

/**
 * This method gets the answer from the transcription service, calculates the
 * offset and adds is to every Word object. It will also start the merging
 * when every send request has been received
 *
 * @param {RecordingResult} answer a RecordingResult object with a defined
 * WordArray
 */
var blobCallBack = function(answer){
    console.log("retrieved an answer from the transcription service. The" +
        " answer has an array of length: " + answer.wordArray.length);
    //first add the offset between the start of the transcription and
    //the start of the recording to all start and end times
    if(answer.wordArray.length > 0) {
        var offset = answer.startTime.getUTCMilliseconds() -
            transcriber.startTime.getUTCMilliseconds();
        //transcriber time will always be earlier
        if (offset < 0) {
            offset = 0; //presume 0 if it somehow not earlier
        }

        var array = "[";
        answer.wordArray.forEach(function (wordObject) {
            wordObject.begin += offset;
            wordObject.end += offset;
            array += wordObject.word+",";
        });
        array += "]";
        console.log(array);
        //give a name value to the Array object so that the merging can access
        //the name value without having to use the whole recordingResult object
        //in the algorithm
        answer.wordArray.name = answer.name;
    }
    //then store the array and decrease the counter
    transcriber.results.push(answer.wordArray);
    transcriber.counter--;
    console.log("current counter: " + transcriber.counter);
    //and check if all results have been received.
    maybeMerge();
};

/**
 * this method will check if the counter is zero. If it is, it will call
 * the merging method
 */
var maybeMerge = function(){
    if(state === TRANSCRIBING_STATE && transcriber.counter === 0){
        //make sure to include the events in the result arrays before
        //merging starts
        merge();
    }
};

/**
 * This method will merge all speech-to-text arrays together in one
 * readable transcription string
 */
var merge = function() {
    console.log("starting merge process!\n The length of the array: " +
        transcriber.results.length);
    var transcription = "";
    //the merging algorithm will look over all Word objects who are at pos 0 in
    //every array. It will then select the one closest in time to the
    //previously placed word, while removing the selected word from its array
    //note: words can be skipped the skipped word's begin and end time somehow
    //end up between the closest word start and end time
    var arrays = transcriber.results;
    //arrays of Word objects
    var potentialWords = []; //array of the first Word objects
    //check if any arrays are already empty and remove them
    hasPopulatedArrays(arrays);

    //populate all the potential Words for a first time
    arrays.forEach(function (array){
        pushWordToSortedArray(potentialWords, array);
    });

    //keep adding words to transcription until all arrays are exhausted
    var lowestWordArray;
    var wordToAdd;
    var foundSmaller;
    while(hasPopulatedArrays(arrays)){
        //first select the lowest array;
        lowestWordArray = arrays[0];
        arrays.forEach(function(wordArray){
           if(wordArray[0].begin < lowestWordArray[0].begin){
               lowestWordArray = wordArray;
           }
        });
        //put the word in the transcription
        wordToAdd = lowestWordArray.shift();
        transcription = updateTranscription(transcription, wordToAdd,
            lowestWordArray.name);

        //keep going until a word in another array has a smaller time
        //or the array is empty
        while(!foundSmaller && lowestWordArray.length > 0){
            arrays.forEach(function(wordArray){
                if(wordArray[0].begin < lowestWordArray[0].begin){
                    foundSmaller = true;
                }
            });
            //add next word if no smaller time has been found
            if(!foundSmaller){
                wordToAdd = lowestWordArray.shift();
                transcription = updateTranscription(transcription, wordToAdd);
            }
        }

    }

    //set the state to finished and do the necessary left-over tasks
    state = FINISHED_STATE;
    transcriber.transcription = transcription;
    if(transcriber.callback){
        transcriber.callback(transcription);
    }
};

/**
 * Appends a word object to a string value. It will make a new line with a
 * name if a name is specified
 * @param {string} transcription  the string to append to
 * @param {Word} word the Word object holding the word to append
 * @param {String|null} name the name of a new speaker. Null if not applicable
 * @returns {string} the transcription string with the appended new information
 */
var updateTranscription = function(transcription, word, name){
    if(name !== undefined && name !== null){
        transcription += "\n" + name + ":";
        lineLength = name.length + 1; //+1 for the semi-colon
    }
    if(lineLength + word.word.length > MAXIMUM_SENTENCE_LENGTH){
        transcription += "\n    ";
        lineLength = 4; //because of the 4 spaces after the new line
    }
    transcription += " " + word.word;
    lineLength += word.word.length + 1; //+1 for the space
    return transcription;
};

/**
 * Used in the updateTranscription method to add a new line when the
 * sentence becomes to long
 * @type {number}
 */
var lineLength = 0;

/**
 * Check if the given 2 dimensional array has any non-zero Word-arrays in them.
 * All zero-element arrays inside will be removed
 * If any non-zero-element arrays are found, the method will return true.
 * otherwise it will return false
 * @param {Array<Array>} twoDimensionalArray the array to check
 * @returns {boolean} true if any non-zero arrays inside, otherwise false
 */
var hasPopulatedArrays = function(twoDimensionalArray){
    var i;
    for(i = 0; i < twoDimensionalArray.length; i++){
        if(twoDimensionalArray[i].length === 0){
            twoDimensionalArray.splice(i, 1);
        }
    }
    return twoDimensionalArray.length > 0;
};

/**
 * Push a word to the right location in a sorted array. The array is sorted
 * from lowest to highest start time. Every word is stored in an object which
 * includes the name of the person saying the word.
 *
 * @param {Array<Word>} array the sorted array to push to
 * @param {Word} word the word to push into the array
 */
var pushWordToSortedArray = function(array, word){
    if(array.length === 0) {
        array.push(word);
    }
    else{
        if(array[array.length - 1].begin <= word.begin){
            array.push(word);
            return;
        }
        var i;
        for(i = 0; i < array.length; i++){
            if(word.begin < array[i].begin){
                array.splice(i, 0, word);
                return;
            }
        }
        array.push(word); //fail safe
    }
};

/**
 * Returns the AudioRecorder module to add and remove tracks to
 */
transcriber.getAudioRecorder = function getAudioRecorder() {
    return this.audioRecorder;
};

/**
 * Will return the created transcription if it's avialable or throw an error
 * when it's not done yet
 * @returns {String} the transcription as a String
 */
transcriber.getTranscription = function(){
    if(state !== FINISHED_STATE){
        throw new Error("The transcription can only be retrieved when it's in" +
            " the\"" + FINISHED_STATE + "\" state. It's currently in the " +
            "\"" + state + "\" state");
    }
    return transcriber.transcription;
};

/**
 * Returns the current state of the transcription process
 */
transcriber.getState = function(){
    return state;
};

/**
 * Resets the state to the "before" state, such that it's again possible to
 * call the start method
 */
transcriber.reset = function() {
    state = BEFORE_STATE;
    this.counter = null;
    this.transcription = null;
    this.startTime = null;
    this.callback = null;
    this.results = [];
};

module.exports = transcriber;