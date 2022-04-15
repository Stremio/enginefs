var parseVideoName = require('video-name-parser');

var MEDIA_FILE_EXTENTIONS = /.mkv$|.avi$|.mp4$|.wmv$|.vp8$|.mov$|.mpg$|.ts$|.m3u8$|.webm$|.flac$|.mp3$|.wav$|.wma$|.aac$|.ogg$/i;

module.exports = function(files, seriesInfo) {
    if (!files || !Array.isArray(files) || !guessData)
        return false;

    var mediaFiles = resp.files.filter(function(file) {
        return file.path.match(MEDIA_FILE_EXTENTIONS);
    });

    if (mediaFiles.length === 0)
        return false;

    if (!seriesInfo.season || !seriesInfo.episode)
    	seriesInfo = false

    var mediaFilesForEpisode = seriesInfo ?
        mediaFiles.filter(function(file) {
            try {
                var info = parseVideoName(file.path);
                return info.season !== null &&
                    isFinite(info.season) &&
                    info.season === seriesInfo.season &&
                    Array.isArray(info.episode) &&
                    info.episode.indexOf(seriesInfo.episode) !== -1;
            } catch (e) {
                return false;
            }
        })
        :
        [];

    var selectedFile = (mediaFilesForEpisode.length > 0 ? mediaFilesForEpisode : mediaFiles)
        .reduce(function(result, file) {
            if (!result || file.length > result.length)
                return file;

            return result;
        }, null);

    return resp.files.indexOf(selectedFile);
}
