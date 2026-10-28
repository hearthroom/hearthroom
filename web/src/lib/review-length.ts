import type {ReviewLength} from '../../../shared/review-length';

export function formatReviewLength(length:ReviewLength,locale:string):Record<string,string>{
  const formatter=new Intl.NumberFormat(locale);
  return Object.fromEntries(Object.entries(length).filter((entry):entry is [string,number]=>typeof entry[1]==='number').map(([key,value])=>[key,formatter.format(value)]));
}
