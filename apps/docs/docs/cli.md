---
title: Command Line Interface
sidebar_position: 4
---

The CLI can be run with

```bash
node <path-to-vestlang>/apps/cli/dist/index.js
```

---

## Inspect

Produce the raw AST from a DSL statement

### Usage

vest inspect [options] [input...]

### Arguments

| Argument | Description   |
| :------- | :------------ |
| input    | DSL statement |

### Options

| Option     | Description |
| :--------- | ----------- |
| -h, --help | dislay help |

---

## Compile

Produce a normalized AST from a DSL statement

### Usage

vest compile [options] [input...]

### Arguments

| Argument | Description   |
| :------- | :------------ |
| input    | DSL statement |

### Options

| Option     | Description |
| :--------- | ----------- |
| -h, --help | dislay help |

---

## Evaluate

Evaluate the vesting schedule produced from a DSL statement

### Usage

vest evaluate [options] [input...]

### Arguments

| Argument | Description   |
| :------- | :------------ |
| input    | DSL statement |

### Options

| Option                          | Description                    |
| :------------------------------ | ------------------------------ |
| -q, --quantity `<number>`       | total number of shares granted |
| -g, --grantDate `<YYYY-MM-DD>`  | grant date of the award        |
| -e, --event `<NAME=YYYY-MM-DD>` | add an event (repeatable)      |
| -h, --help                      | dislay help                    |

---

## As of

Evaluate the vesting schedule produced from a DSL statement as of a given date.

### Usage

vest asOf [options] [input...]

### Arguments

| Argument | Description   |
| :------- | :------------ |
| input    | DSL statement |

### Options

| Option                         | Description                    |
| :----------------------------- | ------------------------------ |
| -q, --quantity `<number>`      | total number of shares granted |
| -g, --grantDate `<YYYY-MM-DD>` | grant date of the award        |
| -d, --date `<YYYY-MM-DD>`      | as-of date                     |
| -h, --help                     | dislay help                    |

---

## Lint

Lint DSL statement and report syntax issues

### Usage

vest lint [options] [input...]

### Arguments

| Argument | Description   |
| :------- | :------------ |
| input    | DSL statement |

### Options

| Option     | Description |
| :--------- | ----------- |
| -h, --help | dislay help |
