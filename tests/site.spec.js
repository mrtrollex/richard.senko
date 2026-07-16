import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = ['/', '/kontakt/', '/richard-senko-en/', '/404.html'];

for (const path of pages) {
  test(`${path} renders without browser or resource errors`, async ({ page }) => {
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    page.on('requestfailed', request => errors.push(`request: ${request.url()} (${request.failure()?.errorText})`));
    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`${path} has no serious accessibility violations @axe`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    // Contrast is reported separately because changing the established palette is outside the no-redesign scope.
    const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
    expect(results.violations.filter(({ impact }) => ['critical', 'serious'].includes(impact))).toEqual([]);
  });
}

test('mobile header navigation remains available and has valid expanded states', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const mobileHeader = page.locator('#ast-mobile-header');
  await expect(mobileHeader.locator('a[href="/"]')).toBeVisible();
  await expect(mobileHeader.locator('a[href="#kontakt"]').first()).toBeVisible();
  await expect(mobileHeader.locator('a[href*="linkedin.com"]')).toBeVisible();
  const expandedValues = await page.locator('[aria-expanded]').evaluateAll(elements => elements.map(element => element.getAttribute('aria-expanded')));
  expect(expandedValues.every(value => value === 'true' || value === 'false')).toBe(true);
});

test('keyboard focus remains visible', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  const outline = await focused.evaluate(element => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe('none');
});

test('visible headings have a single page title and do not skip levels', async ({ page }) => {
  for (const path of pages) {
    await page.goto(path);
    const levels = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll(elements => elements
      .filter(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getAttribute('role') !== 'presentation';
      })
      .map(element => Number(element.getAttribute('aria-level') || element.tagName.slice(1))));
    expect(levels.filter(level => level === 1).length, `${path} h1 count`).toBe(1);
    expect(levels.every((level, index) => index === 0 || level <= levels[index - 1] + 1), `${path} heading order`).toBe(true);
  }
});

test('reduced motion disables nonessential animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const duration = await page.locator('body').evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'elementor-invisible';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const value = { animation: style.animationDuration, transition: style.transitionDuration };
    probe.remove();
    return value;
  });
  expect(parseFloat(duration.animation)).toBeLessThanOrEqual(0.00001);
  expect(parseFloat(duration.transition)).toBeLessThanOrEqual(0.00001);
});
