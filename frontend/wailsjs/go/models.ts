export namespace main {
  export class AdLayout {
    fit: string;
    paddingPx: number;
    background: string;
    width: string;
    height: string;

    static createFrom(source: any = {}) {
      return new AdLayout(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.fit = source["fit"];
      this.paddingPx = source["paddingPx"];
      this.background = source["background"];
      this.width = source["width"];
      this.height = source["height"];
    }
  }

  export class Transition {
    enter: string;
    exit: string;

    static createFrom(source: any = {}) {
      return new Transition(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.enter = source["enter"];
      this.exit = source["exit"];
    }
  }
  export class Ad {
    id: string;
    type: string;
    durationMs: number;
    src?: string;
    poster?: string;
    html?: string;
    transition: Transition;
    layout?: AdLayout;

    static createFrom(source: any = {}) {
      return new Ad(source);
    }

    constructor(source: any = {}) {
      if ("string" === typeof source) source = JSON.parse(source);
      this.id = source["id"];
      this.type = source["type"];
      this.durationMs = source["durationMs"];
      this.src = source["src"];
      this.poster = source["poster"];
      this.html = source["html"];
      this.transition = this.convertValues(source["transition"], Transition);
      this.layout = this.convertValues(source["layout"], AdLayout);
    }

    convertValues(a: any, classs: any, asMap: boolean = false): any {
      if (!a) {
        return a;
      }
      if (a.slice && a.map) {
        return (a as any[]).map((elem) => this.convertValues(elem, classs));
      } else if ("object" === typeof a) {
        if (asMap) {
          for (const key of Object.keys(a)) {
            a[key] = new classs(a[key]);
          }
          return a;
        }
        return new classs(a);
      }
      return a;
    }
  }
}
