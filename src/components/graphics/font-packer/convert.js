const fs = require("fs");
const pngjs = require("pngjs");
const path = require("path");
const minimist = require("minimist");
const spawn = require("child_process").spawn;
const args = minimist(process.argv.slice(2));

/*

Options:
--fontPath: Path to the input font file (default: ../JetBrainsMono[wght].ttf)
--name: Name of the output font (default: derived from input file name)
--outputDir or -o: Directory to save the output atlas and JSON (default: ../fonts/{name})
--include or -i: Comma-separated list of character sets to include (e.g. "base,diacritics,extras" or "all")
--exclude or -e: Comma-separated list of character sets to exclude (e.g. "diacritics")
--charset: Custom string of characters to include in addition to the predefined sets
--ligatures or -l: Include common programming ligatures supported by the font
--noDefaultLigatures: Do not include the default set of programming ligatures, only those specified in --ligatures
--downloadGenerator: Automatically download the msdf-atlas-gen binary if not found

Character sets:
- base: Basic ASCII characters and common symbols
- diacritics: Latin characters with diacritics for European languages
- extras: Additional symbols, currency signs, math operators, etc.
- blockSymbols: Unicode block elements for drawing boxes and progress bars
- boxSymbols: Unicode box-drawing characters
- punct: Common punctuation marks and typographic symbols
- numbers: Digits and related symbols (e.g. fractions)
- cyrillic: Cyrillic alphabet characters
- greek: Greek alphabet characters

Example usage:
node convert.js --fontPath ../MyFont.ttf --name MyFont --outputDir ../fonts/MyFont --include base,diacritics --ligatures "->,=>,==>" --charset "€£¥" --downloadGenerator

*/

async function main() {
    if(!fs.existsSync(__dirname + "/msdf-atlas-gen")) {
        if(args.downloadGenerator) {
            let url, sum;

            if(process.platform === "linux" && process.arch === "x64") {
                // Trusted binary source, built straigt from the official msdf-atlas-gen repository (feel free to verify)
                // Built from commit: c76a32319934c39e51a8c4838240d7b2362b0882 on Fedora 42, February 26 2026
                url = "https://repo.lstv.space/binaries/msdf-atlas-gen-linux-x64";
                sum = "360a3f9c333683ba1f50de0d4b772162b13c293a4d8526d6f6db92613551e5f0";
            } else if(process.platform === "win32" && process.arch === "x64") {
                // Identical to the build from github releases, just extracted from the zip
                url = "https://repo.lstv.space/binaries/msdf-atlas-gen-win-x64.exe";
                sum = "e790f0f50bb432bfbe0115b419168d4a8ebfa9a6b78a515a198c3115c2a19bbd";
            } else {
                console.error("Error: Unsupported platform or architecture for msdf-atlas-gen binary. Please download and build it from https://github.com/Chlumsky/msdf-atlas-gen");
                return;
            }

            const filePath = path.join(__dirname, "msdf-atlas-gen" + (process.platform === "win32" ? ".exe" : ""));

            console.log("Downloading msdf-atlas-gen from", url);
            const curl = spawn("curl", ["-L", url, "-o", filePath]);
            curl.on("close", code => {
                if (code === 0) {
                    // Verify the file hash to ensure it was downloaded correctly and hasn't been tampered with
                    const fileBuffer = fs.readFileSync(filePath);
                    const crypto = require("crypto");
                    const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
                    if (hash !== sum) {
                        console.error(`Error: Hash mismatch for downloaded binary file! Expected ${sum}, got ${hash}. Deleting the file.\nSource: ${url}`);
                        fs.unlinkSync(filePath);
                        return;
                    }

                    fs.chmodSync(filePath, 0o755);
                    console.log("msdf-atlas-gen downloaded and ready to use.");
                    main();
                } else {
                    console.error("Error: Failed to download msdf-atlas-gen. You will need to download and build it from https://github.com/Chlumsky/msdf-atlas-gen, or try again later.");
                }
            });

            return;
        } else {
            console.error("Error: msdf-atlas-gen binary not found. Re-run with --downloadGenerator to download it (requires internet access).");
            return;
        }
    }

    // --- Definitions

    const doAllGlyphs = args.allglyphs || false;

    const fontPath = args.fontPath || path.join(__dirname, "..", args.font || "JetBrainsMono[wght].ttf");
    const fontName = args.name || path.basename(fontPath, path.extname(fontPath));

    const outputDir = args.outputDir || args.o || path.join(__dirname, "..", "fonts", fontName);
    if(!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // The charset we support
    const sets = {
        base:         " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ ¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ~…",
        diacritics:   "ÁĂẮẶẰẲẴǍÂẤẬẦẨẪÄẠÀẢĀĄÅÃÆǼĆČÇĈĊÐĎĐÉĔĚÊẾỆỀỂỄËĖẸÈẺĒĘƐẼǴĞǦĜĢĠĦĤÍĬÎÏİỊÌỈĪĮĨĴĶĹĽĻĿŁŃŇŅŊÑÓŎÔỐỘỒỔỖÖỌÒỎƠỚỢỜỞỠŐŌǪØǾÕŒÞŔŘŖŚŠŞŜȘẞƏŦŤŢȚÚŬÛÜỤÙỦƯỨỰỪỬỮŰŪŲŮŨẂŴẄẀÝŶŸỴỲỶȲỸŹŽŻáăâäàāąåãæǽćčçĉċðďđéĕěêëėèēęəğǧĝġħĥiıíĭîïìīįĩjȷĵĸlĺľŀłmnńŉňŋñóŏôöòơőōøǿõœþŕřsśšşŝßſŧťúŭûüùưűūģķļņŗţǫǵșțạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỵỷỹųůũẃŵẅẁýŷÿỳzźžż",
        extras:       "₿¢¤$₫€ƒ₴₽£₮¥≃∵≬⋈∙≔∁≅∐⎪⋎⋄∣∕∤∸⋐⋱∈∊⋮∎⁼≡≍∹∃∇≳∾⥊⟜⎩⎨⎧⋉⎢⎣⎡≲⋯∓≫≪⊸⊎⨀⨅⨆⊼⋂⋃≇⊈⊉⊽⊴≉∌∉≭≯≱≢≮≰⋢⊄⊅+−×÷=≠><≥≤±≈¬~^∞∅∧∨∩∪∫∆∏∑√∂µ∥⎜⎝⎛⎟⎠⎞%‰﹢⁺≺≼∷≟∶⊆⊇⤖⎭⎬⎫⋊⎥⎦⎤⊢≗∘∼⊓⊔⊡⊟⊞⊠⊏⊑⊐⊒⋆≣⊂≻∋⅀⊃⊤⊣∄∴≋∀⋰⊥⊻⊛⊝⊜⊘⊖⊗⊙⊕↑↗→↘↓↙←↖↔↕↝↭↞↠↢↣↥↦↧⇥↩↪↾⇉⇑⇒⇓⇐⇔⇛⇧⇨⌄⌤➔➜➝➞⟵⟶⟷●○◯◔◕◶◌◉◎◦◆◇◈◊■□▪▫◧◨◩◪◫▲▶▼◀△▷▽◁►◄▻◅▴▸▾◂▵▹▿◃⌶⍺⍶⍀⍉⍥⌾⍟⌽⍜⍪⍢⍒⍋⍙⍫⍚⍱⍦⍎⍊⍖⍷⍩⍳⍸⍤⍛⍧⍅⍵⍹⎕⍂⌼⍠⍔⍍⌺⌹⍗⍌⌸⍄⌻⍇⍃⍯⍰⍈⍁⍐⍓⍞⍘⍴⍆⍮⌿⌷⍣⍭⍨⍲⍝⍡⍕⍑⍏⍬⚇⚠⚡✓✕✗✶@&¶§©®™°′″|¦†ℓ‡№℮␣⎋⌃⌞⌟⌝⌜⎊⎉⌂⇪⌫⌦⌨⌥⇟⇞⌘⏎⏻⏼⭘⏽⏾⌅�˳˷",
        blockSymbols: "▁▂▃▄▅▆▇█▀▔▏▎▍▌▋▊▉▐▕▖▗▘▙▚▛▜▝▞▟░▒▓",
        boxSymbols:   "┌└┐┘┼┬┴├┤─│╡╢╖╕╣║╗╝╜╛╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪━┃┄┅┆┇┈┉┊┋┍┎┏┑┒┓┕┖┗┙┚┛┝┞┟┠┡┢┣┥┦┧┨┩┪┫┭┮┯┰┱┲┳┵┶┷┸┹┺┻┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋╌╍╎╏╭╮╯╰╱╲╳╴╵╶╷╸╹╺╻╼╽╾╿",
        punct:        ".,:;!¡?¿·•*⁅⁆#․‾/\\‿(){}[]❰❮❱❯⌈⌊⌉⌋⦇⦈-­–—‐_‚„“”‘’«»‹›‴\"'⟨⟪⟦⟩⟫⟧·;",
        numbers:      "0123456789₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹½¼¾↋↊૪",
        cyrillic:     "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя",
        greek:        "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω"
    }

    const ligatureTable = {};

    // These are ligatures supported by the JetBrains Mono font and should cover most common coding ligatures. You can add more if your font supports them.
    let ligatures = [...args.noDefaultLigatures? [] : ["--","---","==","===","!=","!==","=!=","=:=","=/=","<=",">=","&&","&&&","&=","++","+++","***",";;","!!","??","???","?:","?.","?=","<:",":<",":>",">:","<:<","<>","<<<",">>>","<<",">>","||","-|","_|_","|-","||-","|=","||=","##","###","####","#{","#[","]#","#(","#?","#_","#_(","#:","#!","#=","^=","<$>","<$","$>","<+>","<+","+>","<*>","<*","*>","</","</>","/>","\x3C!--","<#--","-->","->","->>","<<-","<-","<=<","=<<","<<=","<==","<=>","<==>","==>","=>","=>>",">=>",">>=",">>-",">-","-<","-<<",">->","<-<","<-|","<=|","|=>","|->","<->","<<~","<~~","<~","<~>","~~","~~>","~>","~-","-~","~@","[||]","|]","[|","|}","{|","[<",">]","|>","<|","||>","<||","|||>","<|||","<|>","...","..",".=","..<",".?","::",":::",":=","::=",":?",":?>","//","///","/*","*/","/=","//=","/==","@_","__","???",";;;"], ...typeof args.ligatures === "string"? args.ligatures.split(",") : []];

    // Extensions
    const all = Object.keys(sets);
    const include = ["base", ...(args.include === "all" || args.include === "*" || args.A) ? all : args.include ? args.include.split(",") : []];
    const exclude = args.exclude ? args.exclude.split(",") : [];

    const charset = (args.charset? args.charset : "") + Object.keys(sets).filter(set => {
        if (include && !include.includes(set)) {
            return false;
        }
        if (exclude && exclude.includes(set)) {
            return false;
        }
        return true;
    }).reduce((acc, set) => acc + sets[set], "");

    // ---

    // text-shaper does not work with ligatures
    const HarfBuzz = await require("harfbuzzjs");
    const { Font } = await import("text-shaper");

    const start = performance.now();

    const font = await Font.loadAsync(fs.readFileSync(fontPath).buffer);
    const glyphs = new Map();
    
    if ((args.ligatures || args.l) && ligatures.length > 0) {
        const features = ["liga", "calt", "clig", "dlig"].join(",");

        const blob = HarfBuzz.createBlob(fs.readFileSync(fontPath).buffer); // ArrayBuffer
        const face = HarfBuzz.createFace(blob);
        const font = HarfBuzz.createFont(face);
        // const buffer = HarfBuzz.createBuffer();
        // buffer.addText(ligatures.join(""));
        // buffer.guessSegmentProperties();
        // HarfBuzz.shape(font, buffer, features);
        // const result = buffer.json(font);
        // console.log(result);

        // for (let info of result) {
        //     glyphs.set(info.g, {});
        // }
        const addLigature = (ligature) => {
            const buffer = HarfBuzz.createBuffer();
            buffer.addText(ligature);
            buffer.guessSegmentProperties();
            HarfBuzz.shape(font, buffer, features);

            const result = buffer.json(font);

            for (let info of result) {
                ligatureTable[ligature] = info.g;
                // glyphs.set(info.g, { char: ligature, code: null });
            }

            if(result.length !== 1) {
                console.warn(`Ligature "${ligature}" did not shape to a single glyph`, result);
            }
        }

        for(const ligature of ligatures) {
            addLigature(ligature);
        }
    }

    glyphs.set(1742, { char: null, code: null });

    if(doAllGlyphs) {
        for(let i = 0; i < 65536; i++) {
            const char = String.fromCodePoint(i);
            const codePoint = char.codePointAt(0);
            const glyphId = font.glyphId(codePoint);
            glyphs.set(glyphId, { char, code: codePoint });
        }
    }

    // Add character glyphs
    for (let i = 0; i < charset.length; i++) {
        const char = charset[i];

        const codePoint = char.codePointAt(0);
        if(codePoint !== char.charCodeAt(0)) {
            console.warn("Character", char, "is outside of the 16-bit range");
        }

        const glyphId = font.glyphId(codePoint);
        glyphs.set(glyphId, { char, code: codePoint });
    }


    // --- Generate the atlas

    const types = args.type? args.type.split(","): ["msdf"];

    function iconFontToMap(css, divisor) {
        return css.slice(css.indexOf(divisor)).split(divisor).filter(Boolean).map(i=>{
            i = i.trim();
            const name = i.slice(0, i.indexOf(":"));
            const n = i.slice(i.indexOf("\"") + 2, i.lastIndexOf("\""));
            const value = parseInt(n, 16);
            return [name, value]
        });
    }

    let iconMap;
    if(args.icons) {
        if(!fs.existsSync(args.icons)) {
            console.error("Error: Icon font CSS file not found at", args.icons);
            return;
        }

        if(!args.iconsDivisor) {
            console.error("Error: Icon font divisor not specified");
            return;
        }

        console.log("Reading icon font CSS from", args.icons, "with divisor", args.iconsDivisor);
        iconMap = iconFontToMap(fs.readFileSync(args.icons, "utf-8"), args.iconsDivisor);
    }

    const atlasGenPath = path.join(__dirname, "msdf-atlas-gen" + (process.platform === "win32" ? ".exe" : ""));
    const atlasGenArgs = [
        "--font", fontPath,
        "--size", args.size || "64",
        ...((doAllGlyphs) ? ["-allglyphs"] : ["--glyphs", [...glyphs.keys()].join(",")]),
        "--format", "png",
        "--imageout", path.join(outputDir, "atlas.png"),
        "--json", path.join(outputDir, "font.json"),
        "--type", args.type || "msdf",
        "-emrange", args.emrange || "0.1",
        "-outerpxpadding", args.outerpxpadding || "1",
        // "-scanline", "-overlap", "-coloringstrategy", "distance"
    ];

    const atlasGen = spawn(atlasGenPath, atlasGenArgs);

    atlasGen.stdout.on("data", data => {
        console.log(`[msdf-atlas-gen] ${data}`);
    });

    atlasGen.stderr.on("data", data => {
        console.error(`[msdf-atlas-gen] ${data}`);
    });

    await new Promise((resolve, reject) => {
        atlasGen.on("close", code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`msdf-atlas-gen exited with code ${code}`));
            }
        });
    });

    const atlasData = JSON.parse(fs.readFileSync(path.join(outputDir, "font.json"), "utf-8"));

    if(iconMap) {
        atlasData.nameMap = iconMap;
    }

    const buf = new ArrayBuffer(42 * atlasData.glyphs.length); // 42 bytes for each glyph
    const view = new DataView(buf);
    const b = Buffer.from(buf);

    // We now reformat the atlas data & store ligature information
    let i = 0;
    for(const char of atlasData.glyphs) {
        const glyphInfo = glyphs.get(char.index);
        const idx = i * 42;
        view.setUint16 (idx + 0, i++ || 0);
        view.setUint16 (idx + 2, char.index || 0);
        view.setUint16 (idx + 4, glyphInfo?.code || 0);
        view.setFloat32(idx + 6, char.advance || 0);
        view.setFloat32(idx + 10, char.planeBounds?.top || 0);
        view.setFloat32(idx + 14, char.planeBounds?.left || 0);
        view.setFloat32(idx + 18, char.planeBounds?.bottom || 0);
        view.setFloat32(idx + 22, char.planeBounds?.right || 0);
        view.setFloat32(idx + 26, char.atlasBounds?.top || 0);
        view.setFloat32(idx + 30, char.atlasBounds?.left || 0);
        view.setFloat32(idx + 34, char.atlasBounds?.bottom || 0);
        view.setFloat32(idx + 38, char.atlasBounds?.right || 0);
        // console.log(`Glyph ${i}: index=${char.index}, code=${glyphInfo?.code}, advance=${char.advance}, planeBounds=${char.planeBounds?.top},${char.planeBounds?.left},${char.planeBounds?.bottom},${char.planeBounds?.right}, atlasBounds=${char.atlasBounds?.top},${char.atlasBounds?.left},${char.atlasBounds?.bottom},${char.atlasBounds?.right}`);
    }

    // Layout: [ u16 index, u16 glyphIndex, u16 codePoint, u16 advance, f32 planeTop, f32 planeLeft, f32 planeBottom, f32 planeRight, f32 atlasTop, f32 atlasLeft, f32 atlasBottom, f32 atlasRight ]

    atlasData.byteStride = 42;
    atlasData.glyphs = b.toString("base64");
    atlasData.version = 2;

    // Then save
    fs.writeFileSync(path.join(outputDir, "font.json"), JSON.stringify(atlasData));

    const end = performance.now();
    console.log(`Converted ${glyphs.size} glyphs in ${(end - start).toFixed(2)} ms. Saved as ${outputDir}/atlas.png and ${outputDir}/font.json`);
}

main();

// setInterval(() => {}, 1000);