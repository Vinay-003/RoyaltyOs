/**
 * RoyaltyOS Safe Mathematical Formula Engine
 * 
 * Provides an Abstract Syntax Tree (AST) parser and deterministic evaluator
 * for contractual formulas without using `eval()` or `Function()`.
 */

export type FormulaContext = {
  revenue?: number;
  gross_revenue?: number;
  net_revenue?: number;
  cumulative_revenue?: number;
  cumulative_earnings?: number;
  recoupment_remaining?: number;
  rate?: number;
  fixed?: number;
  [key: string]: unknown;
};

type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENTIFIER"
  | "OPERATOR"
  | "PUNCTUATION"
  | "EOF";

type Token = {
  type: TokenType;
  value: string | number;
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (!ch) break;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number literal
    const nextCh = input[i + 1] || "";
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(nextCh))) {
      let numStr = "";
      while (i < len) {
        const c = input[i];
        if (!c || (!/[0-9]/.test(c) && c !== ".")) break;
        numStr += c;
        i++;
      }
      tokens.push({ type: "NUMBER", value: parseFloat(numStr) });
      continue;
    }

    // String literal (single or double quotes)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      let str = "";
      while (i < len) {
        const c = input[i];
        if (c === quote || !c) break;
        str += c;
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: "STRING", value: str });
      continue;
    }

    // Multi-char operators: ==, !=, <=, >=, &&, ||
    const two = input.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
      tokens.push({ type: "OPERATOR", value: two });
      i += 2;
      continue;
    }

    // Single-char operators
    if (["+", "-", "*", "/", "%", "^", ">", "<", "!"].includes(ch)) {
      tokens.push({ type: "OPERATOR", value: ch });
      i++;
      continue;
    }

    // Punctuation: (, ), ,
    if (["(", ")", ","].includes(ch)) {
      tokens.push({ type: "PUNCTUATION", value: ch });
      i++;
      continue;
    }

    // Identifier: variables, function names
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < len) {
        const c = input[i];
        if (!c || !/[a-zA-Z0-9_]/.test(c)) break;
        ident += c;
        i++;
      }
      tokens.push({ type: "IDENTIFIER", value: ident });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' in formula at index ${i}`);
  }

  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

// AST Nodes
type ASTNode =
  | { type: "Literal"; value: number | string | boolean }
  | { type: "Identifier"; name: string }
  | { type: "UnaryOp"; operator: string; argument: ASTNode }
  | { type: "BinaryOp"; operator: string; left: ASTNode; right: ASTNode }
  | { type: "Call"; callee: string; args: ASTNode[] };

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: "EOF", value: "" };
  }

  private next(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  private match(val: string): boolean {
    if (this.peek().value === val) {
      this.next();
      return true;
    }
    return false;
  }

  parse(): ASTNode {
    const node = this.parseLogicalOr();
    if (this.peek().type !== "EOF") {
      throw new Error(`Unexpected token '${this.peek().value}' after expression`);
    }
    return node;
  }

  private parseLogicalOr(): ASTNode {
    let left = this.parseLogicalAnd();
    while (this.match("||")) {
      const right = this.parseLogicalAnd();
      left = { type: "BinaryOp", operator: "||", left, right };
    }
    return left;
  }

  private parseLogicalAnd(): ASTNode {
    let left = this.parseEquality();
    while (this.match("&&")) {
      const right = this.parseEquality();
      left = { type: "BinaryOp", operator: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): ASTNode {
    let left = this.parseRelational();
    while (this.peek().value === "==" || this.peek().value === "!=") {
      const op = String(this.next().value);
      const right = this.parseRelational();
      left = { type: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  private parseRelational(): ASTNode {
    let left = this.parseAdditive();
    while (["<", "<=", ">", ">="].includes(String(this.peek().value))) {
      const op = String(this.next().value);
      const right = this.parseAdditive();
      left = { type: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    while (this.peek().value === "+" || this.peek().value === "-") {
      const op = String(this.next().value);
      const right = this.parseMultiplicative();
      left = { type: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): ASTNode {
    let left = this.parsePower();
    while (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%") {
      const op = String(this.next().value);
      const right = this.parsePower();
      left = { type: "BinaryOp", operator: op, left, right };
    }
    return left;
  }

  private parsePower(): ASTNode {
    let left = this.parseUnary();
    if (this.match("^")) {
      const right = this.parsePower();
      left = { type: "BinaryOp", operator: "^", left, right };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    if (this.match("-")) {
      return { type: "UnaryOp", operator: "-", argument: this.parseUnary() };
    }
    if (this.match("!")) {
      return { type: "UnaryOp", operator: "!", argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    const token = this.next();

    if (token.type === "NUMBER") {
      return { type: "Literal", value: Number(token.value) };
    }

    if (token.type === "STRING") {
      return { type: "Literal", value: String(token.value) };
    }

    if (token.type === "IDENTIFIER") {
      const name = String(token.value);
      if (this.match("(")) {
        const args: ASTNode[] = [];
        if (!this.match(")")) {
          do {
            args.push(this.parseLogicalOr());
          } while (this.match(","));
          if (!this.match(")")) {
            throw new Error(`Expected ')' after function arguments for '${name}'`);
          }
        }
        return { type: "Call", callee: name.toLowerCase(), args };
      }
      return { type: "Identifier", name };
    }

    if (token.value === "(") {
      const expr = this.parseLogicalOr();
      if (!this.match(")")) {
        throw new Error("Expected ')' matching '('");
      }
      return expr;
    }

    throw new Error(`Unexpected token '${token.value}'`);
  }
}

function evaluateAST(node: ASTNode, ctx: FormulaContext): any {
  switch (node.type) {
    case "Literal":
      return node.value;

    case "Identifier": {
      const name = node.name;
      const lower = name.toLowerCase();
      if (lower === "true") return true;
      if (lower === "false") return false;
      if (lower === "null") return null;

      // Variable lookups
      if (lower in ctx) return ctx[lower];
      if (name in ctx) return ctx[name];

      // Default common numeric aliases
      if (lower === "revenue" || lower === "gross_revenue") return Number(ctx.revenue ?? ctx.gross_revenue ?? 0);
      if (lower === "net_revenue") return Number(ctx.net_revenue ?? ctx.revenue ?? 0);
      if (lower === "cumulative_revenue") return Number(ctx.cumulative_revenue ?? 0);
      if (lower === "cumulative_earnings") return Number(ctx.cumulative_earnings ?? 0);
      if (lower === "recoupment_remaining") return Number(ctx.recoupment_remaining ?? 0);
      if (lower === "rate") return Number(ctx.rate ?? 0);
      if (lower === "fixed") return Number(ctx.fixed ?? 0);

      return 0;
    }

    case "UnaryOp": {
      const arg = evaluateAST(node.argument, ctx);
      if (node.operator === "-") return -Number(arg);
      if (node.operator === "!") return !arg;
      throw new Error(`Unsupported unary operator '${node.operator}'`);
    }

    case "BinaryOp": {
      const left = evaluateAST(node.left, ctx);
      const right = evaluateAST(node.right, ctx);
      switch (node.operator) {
        case "+": return (typeof left === "string" || typeof right === "string") ? `${left}${right}` : Number(left) + Number(right);
        case "-": return Number(left) - Number(right);
        case "*": return Number(left) * Number(right);
        case "/": {
          const div = Number(right);
          if (div === 0) return 0;
          return Number(left) / div;
        }
        case "%": return Number(left) % Number(right);
        case "^": return Math.pow(Number(left), Number(right));
        case "==": return left == right;
        case "!=": return left != right;
        case "<": return Number(left) < Number(right);
        case "<=": return Number(left) <= Number(right);
        case ">": return Number(left) > Number(right);
        case ">=": return Number(left) >= Number(right);
        case "&&": return Boolean(left && right);
        case "||": return Boolean(left || right);
        default: throw new Error(`Unknown operator ${node.operator}`);
      }
    }

    case "Call": {
      const callee = node.callee;
      const evaluatedArgs = node.args.map((a) => evaluateAST(a, ctx));

      if (callee === "if") {
        const [condition, trueVal, falseVal] = evaluatedArgs;
        return condition ? trueVal : (falseVal !== undefined ? falseVal : 0);
      }
      if (callee === "min") {
        return Math.min(...evaluatedArgs.map(Number));
      }
      if (callee === "max") {
        return Math.max(...evaluatedArgs.map(Number));
      }
      if (callee === "clamp") {
        const val = Number(evaluatedArgs[0] ?? 0);
        const minVal = Number(evaluatedArgs[1] ?? 0);
        const maxVal = Number(evaluatedArgs[2] ?? 0);
        return Math.min(Math.max(val, minVal), maxVal);
      }
      if (callee === "round") {
        return Math.round(Number(evaluatedArgs[0] ?? 0));
      }
      if (callee === "floor") {
        return Math.floor(Number(evaluatedArgs[0] ?? 0));
      }
      if (callee === "ceil") {
        return Math.ceil(Number(evaluatedArgs[0] ?? 0));
      }
      if (callee === "abs") {
        return Math.abs(Number(evaluatedArgs[0] ?? 0));
      }

      throw new Error(`Unsupported formula function '${callee}'`);
    }
  }
}

/**
 * Evaluates a mathematical formula string within a given settlement context.
 * Returns an integer minor unit (cents) rounded to nearest whole minor unit.
 */
export function evaluateFormula(formula: string, ctx: FormulaContext = {}): number {
  if (!formula || !formula.trim()) return 0;
  const tokens = tokenize(formula);
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const rawResult = evaluateAST(ast, ctx);
  if (typeof rawResult === "boolean") return rawResult ? 1 : 0;
  const num = Number(rawResult);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
}

/**
 * Validates whether a formula string is syntactically well-formed.
 */
export function validateFormulaSyntax(formula: string): { valid: boolean; error?: string } {
  try {
    if (!formula || !formula.trim()) {
      return { valid: false, error: "Formula cannot be empty" };
    }
    const tokens = tokenize(formula);
    const parser = new Parser(tokens);
    parser.parse();
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message || "Invalid formula syntax" };
  }
}
