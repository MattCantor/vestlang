---
title: Motivation
sidebar_position: 1
---

The motivation for this project is to facilitate a discussion around the following topics

## Current state of vesting templating

The open cap table vesting model aims to support [arbitrarily-complex trees of dependent vesting conditions](https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/explainers/Architecture/#lossless-vesting) that mix time-based and event-based vesting. This is accomplished by expressing vesting as a [_directed_ and _acyclic_ graph of Vesting Condition objects](https://open-cap-table-coalition.github.io/Open-Cap-Format-OCF/explainers/VestingTerms/).

Based on various discussions of the open cap table technical working group, it appears that there has been limited industry adoption of the current templating model.

In August 2024, a `vesting` schema was [introduced](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/commit/150b8da950b00404d1c348c23ea99e7a09f2ae81) to support attaching an explicit array of objects with a vesting date and a vesting amount, as an alternative to using the templating system.

This `vesting` schema represents the canonical representation of a vesting installment. Various industry participants have created their own proprietary vesting schedule templating systems which are used to create these vesting installments.

## How else could we approach vesting templating

The lack of adoption of open cap table's current templating system represents an opportunity to consider an alternative approach. What if instead of using a DAG, we tried an abstract syntax tree.

An abstract syntax tree describing a vesting schedule should describe the following fundamental characteristics of a vesting schedule:

- **Vesting start**:

- **Periodic vesting cadence**:

- **Cliff accrual**:

- **Logical operators**:

In order to determine whether a vesting schedule templating system is sufficiently expressive, we'll use **two-tier** vesting as a requirement. Two-tier vesting refers to a periodic vesting cadence with a standard time-based cliff, as well as an event-based cliff which must be completed by a certain date in the future. The standard two-tier vesting schedule seen in the wild is a 4 year vesting schedule with a 1-year cliff, as well as a cliff on the earlier of an IPO or change in control, so long as the IPO or change in control occurs on prior to the 7th anniversary of the grant date.

### Benefits of using an Abstract Syntax Tree

An abstract syntax tree provides the following benefits over a DAG:

- No need to test for cycles
- Facilitates using a domain specific language (DSL) to describe the vesting schedules
