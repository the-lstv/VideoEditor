const web = require('akeno:web');
const app = web.getApp(__dirname + "/..");
const nodePath = require('path');
const fs = require('fs');


// Script to copy compiled index.html for people who don't use Akeno or local (electron) builds

const copyLocation = "index.html";
app.on("refreshed-cache", (file, entry) => {
    if(file.endsWith("src-index.html")) {
        if(copyLocation) {
            const postCompilePath = nodePath.join(app.path, copyLocation.replace("$FILE", nodePath.basename(file)).replace("$APP", app.basename));
            app.log("Post-compiled file being written to " + postCompilePath);

            fs.promises.writeFile(postCompilePath, entry[0][0], (err) => {
                if(err) {
                    app.error("Failed to copy compiled file to " + postCompilePath + ": ", err)
                }
            });
        }
    }
});