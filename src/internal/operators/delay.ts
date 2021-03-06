import { async } from '../scheduler/async';
import { isValidDate } from '../util/isDate';
import { Operator } from '../Operator';
import { Subscriber } from '../Subscriber';
import { Observable } from '../Observable';
import {
  MonoTypeOperatorFunction,
  SchedulerAction,
  SchedulerLike,
  TeardownLogic
} from '../types';
import { lift } from '../util/lift';

/**
 * Delays the emission of items from the source Observable by a given timeout or
 * until a given Date.
 *
 * <span class="informal">Time shifts each item by some specified amount of
 * milliseconds.</span>
 *
 * ![](delay.png)
 *
 * If the delay argument is a Number, this operator time shifts the source
 * Observable by that amount of time expressed in milliseconds. The relative
 * time intervals between the values are preserved.
 *
 * If the delay argument is a Date, this operator time shifts the start of the
 * Observable execution until the given date occurs.
 *
 * ## Examples
 * Delay each click by one second
 * ```ts
 * import { fromEvent } from 'rxjs';
 * import { delay } from 'rxjs/operators';
 *
 * const clicks = fromEvent(document, 'click');
 * const delayedClicks = clicks.pipe(delay(1000)); // each click emitted after 1 second
 * delayedClicks.subscribe(x => console.log(x));
 * ```
 *
 * Delay all clicks until a future date happens
 * ```ts
 * import { fromEvent } from 'rxjs';
 * import { delay } from 'rxjs/operators';
 *
 * const clicks = fromEvent(document, 'click');
 * const date = new Date('March 15, 2050 12:00:00'); // in the future
 * const delayedClicks = clicks.pipe(delay(date)); // click emitted only after that date
 * delayedClicks.subscribe(x => console.log(x));
 * ```
 *
 * @see {@link debounceTime}
 * @see {@link delayWhen}
 *
 * @param {number|Date} delay The delay duration in milliseconds (a `number`) or
 * a `Date` until which the emission of the source items is delayed.
 * @param {SchedulerLike} [scheduler=async] The {@link SchedulerLike} to use for
 * managing the timers that handle the time-shift for each item.
 * @return {Observable} An Observable that delays the emissions of the source
 * Observable by the specified timeout or Date.
 */
export function delay<T>(delay: number | Date, scheduler: SchedulerLike = async): MonoTypeOperatorFunction<T> {
  const delayFor = isValidDate(delay) ? +delay - scheduler.now() : Math.abs(delay);
  return (source: Observable<T>) => lift(source, new DelayOperator(delayFor, scheduler));
}

class DelayOperator<T> implements Operator<T, T> {
  constructor(private delay: number, private scheduler: SchedulerLike) {}

  call(subscriber: Subscriber<T>, source: any): TeardownLogic {
    return source.subscribe(new DelaySubscriber(subscriber, this.delay, this.scheduler));
  }
}

interface DelayState<T> {
  source: DelaySubscriber<T>;
  destination: Subscriber<T>;
  scheduler: SchedulerLike;
}

/**
 * We need this JSDoc comment for affecting ESDoc.
 * @ignore
 * @extends {Ignored}
 */
class DelaySubscriber<T> extends Subscriber<T> {
  private queue: Array<DelayMessage<T>> = [];
  private active: boolean = false;

  private static dispatch<T>(this: SchedulerAction<DelayState<T>>, state: DelayState<T>): void {
    const source = state.source;
    const queue = source.queue;
    const scheduler = state.scheduler;
    const destination = state.destination;

    while (queue.length > 0 && queue[0].time - scheduler.now() <= 0) {
      destination.next(queue.shift()!.value);
    }

    if (queue.length > 0) {
      const delay = Math.max(0, queue[0].time - scheduler.now());
      this.schedule(state, delay);
    } else if (source.isStopped) {
      source.destination.complete();
      source.active = false;
    } else {
      this.unsubscribe();
      source.active = false;
    }
  }

  constructor(protected destination: Subscriber<T>, private delay: number, private scheduler: SchedulerLike) {
    super(destination);
  }

  private _schedule(scheduler: SchedulerLike): void {
    this.active = true;
    const { destination } = this;
    // TODO: The cast below seems like an issue with typings for SchedulerLike to me.
    destination.add(
      scheduler.schedule<DelayState<T>>(DelaySubscriber.dispatch as any, this.delay, {
        source: this,
        destination,
        scheduler,
      } as DelayState<T>)
    );
  }

  protected _next(value: T) {
    const scheduler = this.scheduler;
    const message = new DelayMessage(scheduler.now() + this.delay, value);
    this.queue.push(message);
    if (this.active === false) {
      this._schedule(scheduler);
    }
  }

  protected _error(err: any) {
    this.queue.length = 0;
    this.destination.error(err);
    this.unsubscribe();
  }

  protected _complete() {
    if (this.queue.length === 0) {
      this.destination.complete();
    }
    this.unsubscribe();
  }
}

class DelayMessage<T> {
  constructor(public readonly time: number, public readonly value: T) {}
}
