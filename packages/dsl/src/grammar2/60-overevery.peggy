Over = "OVER"i _ d:Duration {
    if (d.sign === "MINUS") {
      error("OVER may not include a negative duration")
    }
    return d;
  }

Every = "EVERY"i _ d:Duration {
    if (d.sign === "MINUS") {
      error("EVERY may not include a negative duration")
    }
    return d;
  }

OverEveryOpt
  = o:Over _ e:Every {
    
    if (o.unit !== e.unit) {
      error("EVERY and OVER must have the same units")
    }

    const span = o.value;
    const step = e.value

    if (span === 0 && step !== 0) {
      error("EVERY must be non-zero when OVER is non-zero")
    };

    if (step === 0 && span !== 0) {
      error("OVER must be non-zero when EVERY is non-zero")
    };

    if (span === 0 && step === 0) {
      return {
        type: "DAYS",
        length: 0,
        occurrences: 1
      };
    };

    if (span % step !== 0 ) {
      error("OVER must be a multiple of every")
    };

    return {
      type: o.unit,
      length: step,
      occurrences: span / step
    };
  }

  / o:Over { error("EVERY must be provided when OVER is present"); }
  / e:Every { error("OVER must be provided when EVERY is present"); }

  / "" { return {
        type: "DAYS",
        length: 0,
        occurrences: 1
      }; }

