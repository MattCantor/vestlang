---
title: Introduction
slug: /
sidebar_position: 0
---

**Vestlang** is a domain-specific language (DSL) for expressing vesting schedules in a natural, human-readable form.

Example:

```vest
VEST OVER 4 years EVERY 1 MONTH CLIFF 12 MONTHS
```

The DSL compiles into a **typed Abstract Syntax Tree (AST)**, which is then evaluated into **Open Cap Table** compatible `vesting` objects, with additional metadata.

An overview of the DSL grammar and the compiled AST is provided [here](./02-Grammar_AST.md)

See [here](./03-Evaluation.md) for additional detail regarding the evaluated `vesting` objects and additional metadata.

---

## Vestlang as OCT vesting templating schema

The motivation for this project is to facilitate a discussion within the Open Cap Table project regarding templating for vesting schedules.

The open cap table project aims to support [arbitrarily-complex trees of dependent vesting conditions](https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/explainers/Architecture/#lossless-vesting) that mix time-based and event-based vesting. This is accomplished by expressing vesting as a [directed and acyclic graph of Vesting Condition objects](https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/explainers/VestingTerms/).

In August 2024, a `vesting` schema was [introduced](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/commit/150b8da950b00404d1c348c23ea99e7a09f2ae81) into OCT in order to support attaching an explicit array of objects with a vesting date and a vesting amount, as an alternative to using the templating system.

As a result of this change, vesting schedules can be created in OCT _imperatively_ by providing an array of `vesting` objects. The OCT templating system remains available as a means of creating vesting schedules _declaratively_.

The `vesting` schema represents the canonical representation of a single installment of a vesting schedule, and OCT does not expose a module to convert a declarative expression of a vesting schedule into canonical `vesting` installments.

There has been limited industry adoption of the OCT vesting schedule templating system. However, various industry participants have created their own proprietary vesting schedule templating systems in order to create canonical `vesting` installments.

If we still think that OCT should expose a vesting templating system, then this lack of adoption invites trying out a different approach. Vestlang represents an attempt to try out an abstract syntax tree, rather than a DAG.
