'use strict';

// ブラウザで実行した場合はfsにnullを代入し、Node.jsの場合はfsをrequireする
let fs: any = null;
if (typeof window === "undefined") {
    fs = require("fs");
}

enum Indents {
    None = 0,
    Default = 1,
    Renpy = 1,
    Python = 2,
}

enum Modes {
    Default = "default",
    RenPy = "renpy",
    Python = "python",
    InnerPython = "innerpython",
}

class Compiler {
    input_text: string;
    splited_input: string[];
    output_text: string;

    extended_indents: number = 0;

    linecount: number = 1;

    indent_space: string = "    ";

    characters: {[alias: string]: string} = {};

    currentmode: Modes = Modes.Default;

    constructor(input_text: string) {
        this.input_text = input_text;
        this.splited_input = input_text.split('\n');
        this.output_text = "";
    }

    add_line(line: string = "", indent: Indents | number = Indents.Default): void {
        if (this.currentmode === Modes.InnerPython) {
            // InnerPythonモードでは、インデントが2つ
            // これは、Labelなどの内部でPythonを書くとき、インデントが2つ必要になるため
            indent = Indents.Python;
        } else if (this.currentmode === Modes.Python) {
            // Pythonモードでは、インデントが1つ
            // これは、Labelなどの外部の、.rpyにべた書きでPythonを書くとき、インデントが1つ必要になるため（python:）
            indent = Indents.Default;
        } else if (this.currentmode === Modes.RenPy) {
            // Renpyモードでは、インデントがない
            indent = Indents.None;
        }
        if (line === "") indent = Indents.None; /* 引数なしで関数が実行された場合はlinecountだけ増やす */
        this.output_text += this.indent_space.repeat(indent + this.extended_indents) + line + '\n';
        this.linecount += 1;
        this.extended_indents = 0;
    }

    compile(): string {
        for (let line of this.splited_input) {
            if (this.currentmode === Modes.Python) {
                if (line === "$endpy") {
                    this.currentmode = Modes.Default;
                    this.add_line();
                } else {
                    this.add_line(line);
                }
            } else if (this.currentmode === Modes.RenPy) {
                if (line === "$endrenpy") {
                    this.currentmode = Modes.Default;
                    this.add_line();
                } else {
                    this.add_line(line);
                }
            } else if (this.currentmode === Modes.InnerPython) {
                if (line === "$endinpy") {
                    this.currentmode = Modes.Default;
                    this.add_line();
                } else {
                    this.add_line(line);
                }
            } else if (line === "") {
                this.add_line();
            } else {
                if (line.startsWith("%in%")) {
                    while (line.startsWith("%in%")) {
                        this.extended_indents += 1;
                        line = line.slice(4);
                    }
                }
                if (line.startsWith(";;")) {
                    // ラベル定義
                    const renlabel = line.slice(2);
                    this.add_line(`label ${renlabel}:`, Indents.None);
                } else if (line.includes("「")) {
                    // 会話表現など
                    if (!line.includes("」")) {
                        throw new Error(`[ERR:Say] Line ${this.linecount}: 会話が閉じられていません。`);
                    } else if (line.startsWith("「")) {
                        // ナレーター
                        const message = line.slice(1, -1);
                        if (!message.endsWith("。")) {
                            console.warn(`[WARN:Narrator] Line ${this.linecount}: 会話が句点で終わっていません。適切な表現か確認してください。`);
                        }
                        this.add_line(`"${message}"`);
                    } else {
                        // 通常会話
                        const [character, message] = line.slice(0, -1).split("「");
                        if (character in this.characters) {
                            this.add_line(`${this.characters[character]} "「${message}」"`);
                        } else {
                            this.add_line(`"${character}「${message}」"`);
                        }
                    }
                } else if (line.startsWith(";")) {
                    // エイリアス定義
                    if (!line.includes(":")) {
                        throw new Error(`[ERR:Alias] Line ${this.linecount}: 不正なエイリアス定義です。`);
                    }
                    const [alias, character] = line.slice(1).split(":");
                    this.characters[alias] = character;
                    this.add_line();
                } else if (line.startsWith("#")) {
                    // コメント
                    this.add_line(line);
                } else if (line.startsWith(":")) {
                    // そのまま
                    this.add_line(line.slice(1), Indents.None);
                } else if (line.startsWith("$")) {
                    // 拡張命令
                    const [command, ...args] = line.slice(1).split(" ");
                    if (command === "python") {
                        // Pythonモード
                        this.currentmode = Modes.Python;
                        this.add_line("python:", Indents.None);
                    } else if (command === "renpy") {
                        // RenPyモード
                        this.currentmode = Modes.RenPy;
                        this.add_line();
                    } else if (command === "inpy") {
                        // InnerPythonモード
                        this.currentmode = Modes.InnerPython;
                        this.add_line("python:", Indents.Default);
                    } else if (command == "include") {
                        if (fs === null) {
                            throw new Error(`[ERR:Expansion:Include] Line ${this.linecount}: ブラウザで実行した場合は、include命令は使用できません。`)
                        }
                        // $include [path]
                        // ファイルをfsでインクルードする
                        if (args.length !== 1) {
                            throw new Error(`[ERR:Expansion:Include] Line ${this.linecount}: 不正な引数です。`);
                        }
                        const includepath = args[0];
                        if (!fs.existsSync(includepath)) {
                            throw new Error(`[ERR:Expansion:Include] Line ${this.linecount}: ファイルが存在しません。`);
                        }
                        const includefile = fs.readFileSync(includepath, "utf-8");
                        const compiler = new Compiler(includefile);
                        this.add_line(compiler.compile(), Indents.None);
                    } else {
                        throw new Error(`[ERR:Expansion] Line ${this.linecount}: 不正な拡張命令です。`);
                    }
                } else {
                    throw new Error(`[ERR:Syntax] Line ${this.linecount}: 不正な文法です。`);
                }
            }
        }
        return this.output_text;
    }
}
