'use strict';

const { HttpError } = require('../errors');

function integer(value, label, minimum = 1, maximum = 999999999) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new HttpError(400, `Поле «${label}» должно быть целым числом`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `Поле «${label}»: допустимы числа от ${minimum} до ${maximum}`);
  }
  return number;
}

function text(value, label, maximum, required = true) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `Заполните поле «${label}»`);
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > maximum || (required && !value.trim())) {
    throw new HttpError(400, `Некорректное значение поля «${label}»`);
  }
  return value.trim();
}

function room(body) {
  const result = {
    номер_кабинета: integer(body.номер_кабинета, 'Номер кабинета'),
    количество_парт: integer(body.количество_парт, 'Количество парт', 1, 300),
    количество_рядов_парт: integer(body.количество_рядов_парт, 'Количество рядов', 1, 6),
    этаж: integer(body.этаж, 'Этаж', -5, 100),
  };
  if (result.количество_рядов_парт > result.количество_парт) throw new HttpError(400, 'Количество рядов не должно превышать количество парт');
  return result;
}

function place(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}[АБВГДЕЖЗИКЛМ]$/.test(value)) {
    throw new HttpError(400, 'Неверный номер места');
  }
  return value;
}

module.exports = { integer, text, room, place };
