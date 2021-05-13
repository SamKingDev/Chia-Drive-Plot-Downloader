const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const config = require("./config.json");
const cliProgress = require("cli-progress");

// If modifying these scopes, delete token.json.
const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.photos.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = "token.json";

// Load client secrets from a local file.
fs.readFile("credentials.json", (err, content) => {
  if (err) return console.log("Error loading client secret file:", err);
  // Authorize a client with credentials, then call the Google Drive API.
  authorize(JSON.parse(content), listFiles);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listFiles(auth) {
  var drive = google.drive({ version: "v3", auth });
  drive.files.list(
    {
      pageSize: 1000,
      includeRemoved: false,
      fields: "nextPageToken, files(id, name, size)",
      q: `'${config.folderId}' in parents and trashed = false`,
    },
    (err, res) => {
      if (err) return console.log("The API returned an error: " + err);
      const files = res.data.files.filter((f) => f.size > config.minFileSize);
      if (files.length) {
        downloadFile(files[0].id, files[0].name, files[0].size, drive, auth);
      } else {
        console.log(`No files found - Searching again in ${config.delayMins} minutes`);
        setTimeout(() => {
          listFiles(auth);
        }, config.delayMins * 60 * 1000);
      }
    }
  );
}

function downloadFile(fileId, fileName, size, drive, auth) {
  const filePath = `${config.outputDir}/${fileName}`;
  console.log(`writing to ${filePath}`);
  const dest = fs.createWriteStream(filePath);
  let progress = 0;
  const bar1 = new cliProgress.SingleBar(
    {
      format: "CLI Progress | ({bar}) | {percentage}% || {value}/{total}GB",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    },
    cliProgress.Presets.shades_grey
  );
  bar1.start(parseFloat(size / 1073741824).toFixed(config.downloadDecimalPlaces), 0);
  return drive.files
    .get({ fileId, alt: "media" }, { responseType: "stream" })
    .then((res) => {
      return new Promise((resolve, reject) => {
        res.data
          .on("end", () => {
            bar1.stop();
            console.log("Done downloading " + fileName);
            deleteFile(fileId, fileName, drive, auth);
            resolve(filePath);
          })
          .on("error", (err) => {
            console.error("Error downloading " + fileName);
            reject(err);
          })
          .on("data", (d) => {
            progress += d.length;
            if (process.stdout.isTTY) {
              bar1.update(parseFloat(progress / 1073741824).toFixed(config.downloadDecimalPlaces));
            }
          })
          .pipe(dest);
      }).catch((err) => {
        console.log(err);
        listFiles(auth);
      });
    })
    .catch((err) => {
      console.log(err);
      listFiles(auth);
    });
}

function deleteFile(fileId, fileName, drive, auth) {
  drive.files
    .delete({ fileId })
    .then(() => {
      console.log("Downloaded - " + fileName);
      listFiles(auth);
    })
    .catch((err) => {
      console.log(err);
      listFiles(auth);
    });
}
