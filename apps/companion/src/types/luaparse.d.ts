/**
 * Minimal ambient declarations for the `luaparse` npm package.
 *
 * The upstream package does not ship types and the community @types
 * packages are outdated. We only use a small subset of the AST, so
 * declaring only what we need is the cleanest option.
 *
 * https://github.com/fstirlitz/luaparse
 */

declare module "luaparse" {
  export interface ParseOptions {
    comments?: boolean;
    locations?: boolean;
    ranges?: boolean;
    luaVersion?: "5.1" | "5.2" | "5.3" | "LuaJIT";
    encodingMode?: "pseudo-latin1" | "x-user-defined" | "none";
  }

  export interface NodeBase {
    type: string;
  }

  export interface Chunk extends NodeBase {
    type: "Chunk";
    body: Statement[];
  }

  export type Statement =
    | AssignmentStatement
    | LocalStatement
    | ReturnStatement
    | NodeBase;

  export interface AssignmentStatement extends NodeBase {
    type: "AssignmentStatement";
    variables: Expression[];
    init: Expression[];
  }

  export interface LocalStatement extends NodeBase {
    type: "LocalStatement";
    variables: Identifier[];
    init: Expression[];
  }

  export interface ReturnStatement extends NodeBase {
    type: "ReturnStatement";
    arguments: Expression[];
  }

  export type Expression =
    | Identifier
    | StringLiteral
    | NumericLiteral
    | BooleanLiteral
    | NilLiteral
    | TableConstructorExpression
    | UnaryExpression
    | IndexExpression
    | MemberExpression
    | NodeBase;

  export interface Identifier extends NodeBase {
    type: "Identifier";
    name: string;
  }

  export interface StringLiteral extends NodeBase {
    type: "StringLiteral";
    value: string;
    raw: string;
  }

  export interface NumericLiteral extends NodeBase {
    type: "NumericLiteral";
    value: number;
    raw: string;
  }

  export interface BooleanLiteral extends NodeBase {
    type: "BooleanLiteral";
    value: boolean;
    raw: string;
  }

  export interface NilLiteral extends NodeBase {
    type: "NilLiteral";
    value: null;
    raw: string;
  }

  export interface UnaryExpression extends NodeBase {
    type: "UnaryExpression";
    operator: string;
    argument: Expression;
  }

  export interface TableConstructorExpression extends NodeBase {
    type: "TableConstructorExpression";
    fields: Field[];
  }

  export type Field = TableKey | TableKeyString | TableValue;

  export interface TableKey extends NodeBase {
    type: "TableKey";
    key: Expression;
    value: Expression;
  }

  export interface TableKeyString extends NodeBase {
    type: "TableKeyString";
    key: Identifier;
    value: Expression;
  }

  export interface TableValue extends NodeBase {
    type: "TableValue";
    value: Expression;
  }

  export interface IndexExpression extends NodeBase {
    type: "IndexExpression";
    base: Expression;
    index: Expression;
  }

  export interface MemberExpression extends NodeBase {
    type: "MemberExpression";
    indexer: string;
    base: Expression;
    identifier: Identifier;
  }

  export function parse(source: string, options?: ParseOptions): Chunk;
}
