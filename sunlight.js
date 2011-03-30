(function(window, undefined){

	//http://javascript.crockford.com/prototypal.html
	var create = function(o) {
        function F() {}
        F.prototype = o;
        return new F();
    }
	
	//array.contains()
	var contains = function(arr, value, caseInsensitive) {
		for (var i = 0; i < arr.length; i++) {
			if (arr[i] === value) {
				return true;
			}
			
			if (caseInsensitive && typeof(arr[i]) === "string" && typeof(value) === "string" && arr[i].toUpperCase() === value.toUpperCase()) {
				return true;
			}
		}
		
		return false;
	};
	
	//recursively merges one object into the other
	var merge = function(defaultObject, objectToMerge) {
		if (!objectToMerge) {
			return defaultObject;
		}
		
		for (var key in objectToMerge) {
			if (defaultObject[key] !== undefined && typeof(objectToMerge[key]) === "object") {
				defaultObject[key] = merge(defaultObject[key], objectToMerge[key]);
			} else {
				defaultObject[key] = objectToMerge[key];
			}
		}
		
		return defaultObject;
	};
	
	//http://stackoverflow.com/questions/3561493/is-there-a-regexp-escape-function-in-javascript/3561711#3561711
	var regexEscape = function(s) {
		return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
	};
	
	var createProceduralRule = function(startIndex, direction, tokenRequirements, caseInsensitive) {
		return function(tokens) {
			var tokenIndexStart = startIndex;
			if (direction === 1) {
				tokenRequirements.reverse();
			}
			
			for (var j = 0, expected, actual; j < tokenRequirements.length; j++) {
				actual = tokens[tokenIndexStart + (j * direction)];
				expected = tokenRequirements[tokenRequirements.length - 1 - j];
				
				if (actual === undefined) {
					if (expected["optional"] !== undefined && expected.optional) {
						tokenIndexStart -= direction;
					} else {
						return false;
					}
				} else if (actual.name === expected.token && (expected["values"] === undefined || contains(expected.values, actual.value, caseInsensitive))) {
					//derp
					continue;
				} else if (expected["optional"] !== undefined && expected.optional) {
					tokenIndexStart -= direction; //we need to reevaluate against this token again
				} else {
					return false;
				}
			}
			
			return true;
		};
	};
	
	var createBetweenRule = function(startIndex, opener, closer, caseInsensitive) {
		return function(tokens) {
			var index = startIndex, token;
			var success = false;
			
			//check to the left: if we run into a closer or never run into an opener, fail
			while ((token = tokens[--index]) !== undefined) {
				if (token.name === closer.token && contains(closer.values, token.value)) {
					if (token.name === opener.token && contains(opener.values, token.value, caseInsensitive)) {
						//if the closer is the same as the opener that's okay
						success = true;
						break;
					}
					
					return false;
				}
				
				if (token.name === opener.token && contains(opener.values, token.value, caseInsensitive)) {
					success = true;
					break;
				}
			}
			
			if (!success) {
				return false;
			}
			
			//check to the right for the closer
			index = startIndex;
			while ((token = tokens[++index]) !== undefined) {
				if (token.name === opener.token && contains(opener.values, token.value, caseInsensitive)) {
					if (token.name === closer.token && contains(closer.values, token.value, caseInsensitive)) {
						//if the closer is the same as the opener that's okay
						success = true;
						break;
					}
					
					return false;
				}
				
				if (token.name === closer.token && contains(closer.values, token.value, caseInsensitive)) {
					success = true;
					break;
				}
			}
		
			return success;
		};
	};
	
	var defaultEnter = function(suffix) {
		return function(context) {
			return context.append("<span class=\"sunlight-" + suffix + " sunlight-" + context.language.name + "\">") || true;
		};
	};
	
	var defaultExit = function(context) {
		return context.append("</span>") || true;
	};
	
	var defaultAnalyzer = {
		enterKeyword:      defaultEnter("keyword"),
		exitKeyword:       defaultExit,
		enterOperator:     defaultEnter("operator"),
		exitOperator:      defaultExit,
		enterString:       defaultEnter("string"),
		exitString:        defaultExit,
		enterPunctuation:  defaultEnter("punctuation"),
		exitPunctuation:   defaultExit,
		enterNumber:       defaultEnter("number"),
		exitNumber:        defaultExit,
		enterComment:      defaultEnter("comment"),
		exitComment:       defaultExit,
		
		exitIdent:         defaultExit,
		enterDefault:      function(context) { },
		exitDefault:       function(context) { },
		writeCurrentToken: function(context) { context.appendAndEncode(context.tokens[context.index].value); },
		
		enterIdent: function(context) {
			var iterate = function(rules, createRule) {
				rules = rules || [];
				for (var i = 0; i < rules.length; i++) {
					if (typeof(rules[i]) === "function") {
						if (rules[i](context)) {
							return defaultEnter("named-ident")(context);
						}
					} else if (createRule && createRule(rules[i])(context.tokens)) {
						return defaultEnter("named-ident")(context);
					}
				}
				
				return false;
			};
			
			iterate(context.language.namedIdentRules.custom)
				|| iterate(context.language.namedIdentRules.follows, function(ruleData) { return createProceduralRule(context.index - 1, -1, ruleData.slice(0), context.language.caseInsensitive); })
				|| iterate(context.language.namedIdentRules.precedes, function(ruleData) { return createProceduralRule(context.index + 1, 1, ruleData.slice(0), context.language.caseInsensitive); })
				|| iterate(context.language.namedIdentRules.between, function(ruleData) { return createBetweenRule(context.index, ruleData.opener, ruleData.closer, context.language.caseInsensitive); })
				|| defaultEnter("ident")(context);
		}
	};
	
	//registered languages
	var languages = { };
	
	var createCodeReader = function(text) {
		text = text.replace("\r\n", "\n").replace("\r", "\n"); //normalize line endings to unix
		var index = 0;
		var line = 1;
		var column = 1;
		var length = text.length;
		var EOF = undefined;
		var currentChar = length > 0 ? text[0] : EOF;
		var nextReadBeginsLine = false;
		
		var getCharacters = function(count) {
			if (count === 0) {
				return "";
			}
			
			count = count || 1;
			
			var value = "";
			var num = 1;
			while (num <= count && text[index + num] !== EOF) {
				value += text[index + num++];
			}
			
			return value === "" ? EOF : value;
		};
		
		return {
			toString: function() {
				return "length: " + length + ", index: " + index + ", line: " + line + ", column: " + column + ", current: [" + currentChar + "]";
			},
			
			peek: function(count) {
				return getCharacters(count);
			},
			
			read: function(count) {
				var value = getCharacters(count);
				
				if (value !== EOF) {
					//advance index
					index += value.length;
					column += value.length;
					
					//update line count
					if (nextReadBeginsLine) {
						line++;
						column = 1;
						nextReadBeginsLine = false;
					}
					
					var newlineCount = value.substring(0, value.length - 1).replace(/[^\n]/g, "").length;
					if (newlineCount > 0) {
						line += newlineCount;
						column = 1;
					}
					
					if (value[value.length - 1] === "\n") {
						nextReadBeginsLine = true;
					}
					
					currentChar = value[value.length - 1];
				} else {
					index = length;
					currentChar = EOF;
				}
				
				return value;
			},
			
			getLine: function() { return line; },
			getColumn: function() { return column; },
			isEof: function() { return index >= length; },
			EOF: EOF,
			current: function() { return currentChar; }
		};
	};
	
	var highlighter = function() {
		var getScopeReaderFunction = function(scope, tokenName) {
			var escapeSequences = scope[2] || [];
			var closerLength = scope[1].length;
			var closer = typeof(scope[1]) === "string" ? new RegExp(regexEscape(scope[1])) : scope[1].regex;
			var zeroWidth = scope[3] || false;
			
			//processCurrent indicates that this is being called from a continuation
			//which means that we need to process the current char, rather than peeking at the next
			return function(context, continuation, buffer, line, column, processCurrent) {
				var foundCloser = false, buffer = buffer || "";
				processCurrent = processCurrent ? 1 : 0;
				
				var process = function(processCurrent) {
					//check for escape sequences
					var peekValue;
					var current = context.reader.current();
					for (var i = 0; i < escapeSequences.length; i++) {
						peekValue = (processCurrent ? current : "") + context.reader.peek(escapeSequences[i].length - processCurrent);
						if (peekValue === escapeSequences[i]) {
							buffer += context.reader.read(peekValue.length - processCurrent);
							return true;
						}
					}
					
					peekValue = (processCurrent ? current : "") + context.reader.peek(closerLength - processCurrent);
					if (closer.test(peekValue)) {
						foundCloser = true;
						return false;
					}
					
					buffer += processCurrent ? current : context.reader.read();
					return true;
				};
				
				if (!processCurrent || process(true)) {
					while (context.reader.peek() !== context.reader.EOF && process(false)) { }
				}
				
				if (processCurrent) {
					buffer += context.reader.current();
					context.reader.read();
				} else {
					buffer += zeroWidth || context.reader.peek() === context.reader.EOF ? "" : context.reader.read(closerLength);
				}
				
				if (!foundCloser) {
					//we need to signal to the context that this scope was never properly closed
					//this has significance for partial parses (e.g. for nested languages)
					context.continuation = continuation;
				}
				
				return context.createToken(tokenName, buffer, line, column);
			};
		};
		
		var parseNextToken = function(context) {
			//helpers
			var matchWord = function(wordMap, name, boundary) {
				wordMap = wordMap || [];
				var current = context.reader.current();
				for (var i = 0, word; i < wordMap.length; i++) {
					word = wordMap[i];
					if (word[0] === current || (context.language.caseInsensitive && word[0].toUpperCase() === current.toUpperCase())) {
						var peek = current + context.reader.peek(word.length);
						if (word === peek || new RegExp(regexEscape(word) + boundary, context.language.caseInsensitive ? "i" : "").test(peek)) {
							var readChars = current + context.reader.read(word.length - 1); //read to the end of the word (we already read the first letter)
							return context.createToken(name, readChars, context.reader.getLine());
						}
					}
				}
				
				return null;
			};
		
			var isIdentMatch = function() {
				return context.language.identFirstLetter && context.language.identFirstLetter.test(context.reader.current());
			};
		
			//token parsing functions
			var parseKeyword = function() {
				return matchWord(context.language.keywords, "keyword", "\\b");
			};
			
			var parseCustomTokens = function() {
				if (context.language.customTokens === undefined) {
					return null;
				}
				
				for (var tokenName in context.language.customTokens) {
					var token = matchWord(context.language.customTokens[tokenName], tokenName, "\\b");
					if (token !== null) {
						return token;
					}
				}
				
				return null;
			};
			
			var parseOperator = function() {
				return matchWord(context.language.operators, "operator", "");
			};
			
			var parsePunctuation = function() {
				var current = context.reader.current();
				if (/[^\w\s]/.test(regexEscape(current))) {
					return context.createToken("punctuation", current, context.reader.getLine());
				}
				
				return null;
			};
			
			var parseIdent = function(isNamed) {
				if (!isIdentMatch()) {
					return null;
				}
				
				var ident = context.reader.current();
				var peek = context.reader.peek();
				while (peek !== context.reader.EOF) {
					if (!context.language.identAfterFirstLetter.test(peek)) {
						break;
					}
					
					ident += context.reader.read();
					peek = context.reader.peek();
				}
				
				return context.createToken(isNamed ? "namedIdent" : "ident", ident, context.reader.getLine());
			};
			
			var parseDefault = function() {
				if (context.defaultData.text === "") {
					//new default token
					context.defaultData.line = context.reader.getLine();
					context.defaultData.column = context.reader.getColumn();
				}
				
				context.defaultData.text += context.reader.current();
				return null;
			};
			
			var parseScopes = function() {
				var current = context.reader.current();
				
				for (var tokenName in context.language.scopes) {
					var specificScopes = context.language.scopes[tokenName];
					for (var j = 0, opener, line, column, continuation; j < specificScopes.length; j++) {
						opener = specificScopes[j][0];
						
						if (opener !== current + context.reader.peek(opener.length - 1)) {
							continue;
						}
						
						line = context.reader.getLine(), column = context.reader.getColumn();
						context.reader.read(opener.length - 1);
						continuation = getScopeReaderFunction(specificScopes[j], tokenName);
						return continuation(context, continuation, opener, line, column);
					}
				}
				
				return null;
			};
			
			var parseNumber = function() {
				var current = context.reader.current();
				var number;
				
				if (!/\d/.test(current)) {
					//is it a decimal followed by a number?
					if (current !== "." || !/\d/.test(context.reader.peek())) {
						return null;
					}
					
					//decimal without leading zero
					number = current + context.reader.read();
				} else {
					number = current;
					//is it a decimal?
					if (context.reader.peek() === ".") {
						number += context.reader.read();
					}
				}
				
				//easy way out: read until it's not a number or letter
				//this will work for hex (0xef), octal (012), decimal and scientific notation (1e3)
				//anything else and you're on your own
				
				var peek = context.reader.peek();
				while (peek !== context.reader.EOF) {
					if (!/[A-Za-z0-9]/.test(peek)) {
						break;
					}
					
					number += context.reader.read();
					peek = context.reader.peek();
				}
				
				return context.createToken("number", number, context.reader.getLine());
			};
			
			var parseCustomRules = function() {
				var customRules = context.language.customParseRules;
				if (customRules === undefined) {
					return null;
				}
				
				for (var i = 0, token; i < customRules.length; i++) {
					token = customRules[i](context);
					if (token !== null) {
						return token;
					}
				}
				
				return null;
			};
			
			return parseCustomRules()
				|| parseCustomTokens()
				|| parseKeyword()
				|| parseScopes()
				|| parseIdent()
				|| parseNumber()
				|| parseOperator()
				|| parsePunctuation()
				|| parseDefault();
		};
		
		var tokenize = function(unhighlightedCode, language, continuation) {
			var tokens = [];
			var context = function() {
				return {
					reader: createCodeReader(unhighlightedCode), 
					language: language,
					token: function(index) { return tokens[index]; },
					getAllTokens: function() { return tokens.slice(0); },
					count: function() { return tokens.length; },
					defaultData: {
						text: "",
						line: 1,
						column: 1
					},
					createToken: function(name, value, line, column) {
						return {
							name: name,
							line: line,
							value: value,
							column: column
						};
					}
				};
			}();
			
			//if continuation is given, then we need to pick up where we left off from a previous parse
			//basically it indicates that a scope was never closed, so we need to continue that scope
			if (continuation) {
				console.log("handling continuation");
				console.log(context.reader.toString());
				tokens.push(continuation(context, continuation, "", context.reader.getLine(), context.reader.getColumn(), true));
			}
			
			while (!context.reader.isEof()) {
				var token = parseNextToken(context);
				
				//flush default data if needed (in pretty much all languages this is just whitespace (a notable exception is XML (nested parens)))
				if (token !== null) {
					if (context.defaultData.text !== "") {
						tokens.push(context.createToken("default", context.defaultData.text, context.defaultData.line, context.defaultData.column)); 
						context.defaultData.text = "";
					}
					
					if (token[0] !== undefined) {
						//multiple tokens
						tokens = tokens.concat(token);
					} else {
						//single token
						tokens.push(token);
					}
				}
				
				context.reader.read();
			}
			
			return { tokens: tokens, continuation: context.continuation };
		};
		
		
		var createAnalyzerContext = function(unhighlightedCode, language, partialContext, options) {
			var buffer = "";
			
			//based on http://phpjs.org/functions/htmlentities:425
			var encode = function() {
				var charMap = [
					["&", "&amp;"],
					["'", "&#039;"],
					["<", "&lt;"],
					[">", "&gt;"],
					["\t", new Array(options.tabWidth).join("&#160;")],
					[" ", "&#160;"]
				];
				
				return function(text) {
					var encodedText = text;
					for (var i = 0; i < charMap.length; i++) {
						encodedText = encodedText.split(charMap[i][0]).join(charMap[i][1]);
					}
					
					return encodedText;
				};
			}();
			
			var parseData = tokenize(unhighlightedCode, language, partialContext.continuation);
			
			return {
				tokens: (partialContext.tokens || []).concat(parseData.tokens),
				index: partialContext.index ? partialContext.index + 1 : 0,
				language: language,
				continuation: parseData.continuation,
				append: function(text) { buffer += text; },
				appendAndEncode: function(text) { buffer += encode(text); },
				getHtml: function() { return buffer; }
			};
		};
		
		return {
			//partialContext allows us to perform a partial parse, and then pick up where we left off at a later time
			//this functionality enables nested highlights (language withint a language, e.g. PHP within HTML followed by more PHP)
			highlight: function(unhighlightedCode, languageId, partialContext) {
				partialContext = partialContext || { };
				var language = languages[languageId];
				if (language === undefined) {
					throw "Unregistered language: " + languageId;
				}
			
				var analyzerContext = createAnalyzerContext(unhighlightedCode, language, partialContext, this.options);
				var analyzer = language.analyzer || this.options.analyzer;
				var map = merge(this.options.tokenAnalyzerMap, language.tokenAnalyzerMap);
				
				for (var i = partialContext.index ? partialContext.index + 1 : 0, funcs; i < analyzerContext.tokens.length; i++) {
					analyzerContext.index = i;
					funcs = map[analyzerContext.tokens[i].name];
					if (funcs === undefined) {
						throw "Unknown token \"" + analyzerContext.tokens[i].name + "\"";
					}
					
					try {
						//enter
						analyzer[funcs[0]](analyzerContext);
						
						//write token value
						analyzer.writeCurrentToken(analyzerContext);
						
						//exit
						analyzer[funcs[1]](analyzerContext);
					} catch (e) {
						console.dir(funcs);
						throw e;
					}
				}
				
				return analyzerContext;
			}
		};
	}();
	
	var highlighterConstructor = function() {
		var defaults = {
			analyzer: create(defaultAnalyzer),
			tabWidth: 4,
			tokenAnalyzerMap: {
				keyword: ["enterKeyword", "exitKeyword"],
				operator: ["enterOperator", "exitOperator"],
				string: ["enterString", "exitString"],
				comment: ["enterComment", "exitComment"],
				ident: ["enterIdent", "exitIdent"],
				punctuation: ["enterPunctuation", "exitPunctuation"],
				number: ["enterNumber", "exitNumber"],
				"default": ["enterDefault", "exitDefault"],
			}
		};
		
		return function(options) {
			var merged = defaults;
			if (options) {
				merged = merge(temp, options);
			}
			
			this.options = merged;
		};
	}();
	
	highlighterConstructor.prototype = highlighter;
	
	var getNextNonWsToken = function(tokens, index, direction) {
		direction = direction || 1;
		var token = tokens[index + direction];
		if (token !== undefined && token.name === "default") {
			token = tokens[index + (direction * 2)];
		}
		
		return token;
	};
	
	function highlightRecursive(highlighter, node) {
		var match, languageId;
		if ((match = node.className.match(/\s*sunlight-highlight-(\S+)\s*/)) === null || /(?:\s|^)sunlight-highlighted\s*/.test()) {
			//not a valid sunlight node or it's already been highlighted
			return;
		}
		
		languageId = match[1];
		var partialContext = null;
		for (var j = 0; j < node.childNodes.length; j++) {
			if (node.childNodes[j].nodeType === 3) {
				//wrap in span
				var span = document.createElement("span");
				span.className = "sunlight-highlighted";
				//console.log(node.childNodes[j].nodeValue);
				partialContext = highlighter.highlight(node.childNodes[j].nodeValue, languageId, partialContext);
				span.innerHTML = partialContext.getHtml();
				node.replaceChild(span, node.childNodes[j]);
			} else {
				highlightRecursive(highlighter, node.childNodes[j]);
			}
		}
		
		//indicate that this node has been highlighted
		node.className += " sunlight-highlighted";
	}
	
	window.Sunlight = {
		version: "1.0",
		Highlighter: highlighterConstructor,
		createAnalyzer: function() { return create(defaultAnalyzer); },
		isRegistered: function(languageId) { return languages[languageId] !== undefined; },
		defaultEscapeSequences: ["\\n", "\\t", "\\r", "\\\\", "\\v", "\\f"],
		enterAnalysis: defaultEnter,
		exitAnalysis: defaultExit,
		
		highlightAll: function(options) { 
			var highlighter = new highlighterConstructor(options);
			var tags = document.getElementsByTagName("*");
			for (var i = 0; i < tags.length; i++) {
				highlightRecursive(highlighter, tags[i]);
			}
		},
		
		registerLanguage: function(languageIds, languageData) {
			if (languageIds.length === 0) {
				throw "Languages must be registered with at least one identifier, e.g. \"php\" for PHP";
			}
			
			for (var i = 0; i < languageIds.length; i++) {
				languageData.name = languageIds[i];
				languages[languageIds[i]] = languageData;
			}
		},
		
		helpers: {
			contains: contains,
			createBetweenRule: createBetweenRule,
			createProceduralRule: createProceduralRule,
			getNextNonWsToken: function(tokens, index) { return getNextNonWsToken(tokens, index, 1); },
			getPreviousNonWsToken: function(tokens, index) { return getNextNonWsToken(tokens, index, -1); }
		}
	};

}(window));