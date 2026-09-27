import { describe, expect, it } from 'vitest'
import { lensId, parseLensfunXml, parseXml } from './lensfun-xml'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<lensdatabase version="1">
    <mount>
        <name>Fujifilm X</name>
        <compat>M42</compat>
        <compat>Generic</compat>
    </mount>
    <camera>
        <maker>Fujifilm</maker>
        <model>X-E1</model>
        <mount>Fujifilm X</mount>
        <cropfactor>1.529</cropfactor>
    </camera>
    <camera>
        <maker>Sony</maker>
        <model>ILCE-7C</model>
        <variant>black</variant>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
    </camera>
    <lens>
        <maker>Fujifilm</maker>
        <model>XF18-55mmF2.8-4 R LM OIS</model>
        <model lang="en">XF 18-55mm f/2.8-4 R LM OIS</model>
        <mount>Fujifilm X</mount>
        <cropfactor>1.529</cropfactor>
        <calibration>
            <!-- Taken with X-E1 -->
            <distortion model="ptlens" focal="18" a="0.02808" b="-0.10604" c="0.07041"/>
            <distortion model="ptlens" focal="55" a="0.00491" b="-0.00114" c="0.01427"/>
            <tca model="poly3" focal="18" br="-0.0001885" vr="1.0006600" bb="0.0001738" vb="0.9998316"/>
            <vignetting model="pa" focal="18" aperture="2.8" distance="10" k1="-0.9940" k2="0.9214" k3="-0.6090"/>
            <vignetting model="pa" focal="18" aperture="4" distance="1000" k1="-0.2929" k2="-0.2031" k3="-0.0206"/>
        </calibration>
        <calibration cropfactor="1" aspect-ratio="3:2">
            <distortion model="poly3" focal="18" k1="-0.01" real-focal="18.4"/>
        </calibration>
    </lens>
    <lens>
        <maker>Samyang</maker>
        <model>8mm f/3.5 Fish-eye &amp; more</model>
        <mount>Canon EF</mount>
        <mount>Nikon F</mount>
        <type>fisheye</type>
        <calibration>
            <distortion model="acm" focal="8" k1="0.1"/>
            <tca model="linear" focal="8" kr="1.0002" kb="0.9998"/>
        </calibration>
    </lens>
</lensdatabase>`

describe('the little XML parser', () => {
  it('reads elements, attributes, text, entities and comments', () => {
    const root = parseXml('<a x="1&amp;2"><!-- no --><b>t&lt;</b><c/></a>')
    const a = root.children[0]
    expect(a.tag).toBe('a')
    expect(a.attrs.x).toBe('1&2')
    expect(a.children.map((c) => c.tag)).toEqual(['b', 'c'])
    expect(a.children[0].text).toBe('t<')
  })

  it('refuses a document whose tags do not pair up', () => {
    expect(() => parseXml('<a><b></a>')).toThrow()
  })
})

describe('the Lensfun database', () => {
  const db = parseLensfunXml(SAMPLE)

  it('reads mounts with their compatibility list', () => {
    expect(db.mounts).toEqual([{ name: 'Fujifilm X', compat: ['M42', 'Generic'] }])
  })

  it('reads cameras, variants included', () => {
    expect(db.cameras[0]).toEqual({ maker: 'Fujifilm', model: 'X-E1', mount: 'Fujifilm X', crop: 1.529 })
    expect(db.cameras[1].variant).toBe('black')
  })

  it('keeps the canonical model as the key and the English one for display', () => {
    const lens = db.lenses[0]
    expect(lens.model).toBe('XF18-55mmF2.8-4 R LM OIS')
    expect(lens.name).toBe('XF 18-55mm f/2.8-4 R LM OIS')
    expect(lens.id).toBe(lensId('Fujifilm', 'XF18-55mmF2.8-4 R LM OIS'))
    expect(lens.id).toBe('fujifilm-xf18-55mmf2-8-4-r-lm-ois')
  })

  it('reads every calibration model in Lensfun\'s own term order', () => {
    const [legacy, explicit] = db.lenses[0].calibrations
    expect(legacy.crop).toBe(1.529)
    expect(legacy.aspect).toBe(1.5)
    expect(legacy.distortion[0]).toEqual({ model: 'ptlens', focal: 18, terms: [0.02808, -0.10604, 0.07041] })
    expect(legacy.tca[0]).toEqual({
      model: 'poly3',
      focal: 18,
      terms: [1.00066, 0.9998316, 0, 0, -0.0001885, 0.0001738],
    })
    expect(legacy.vignetting[1]).toEqual({
      model: 'pa',
      focal: 18,
      aperture: 4,
      distance: 1000,
      terms: [-0.2929, -0.2031, -0.0206],
    })
    expect(explicit.crop).toBe(1)
    expect(explicit.aspect).toBe(1.5)
    expect(explicit.distortion[0]).toEqual({ model: 'poly3', focal: 18, realFocal: 18.4, terms: [-0.01] })
  })

  it('summarises focal range, aperture and what a lens can correct', () => {
    const lens = db.lenses[0]
    expect(lens.minFocal).toBe(18)
    expect(lens.maxFocal).toBe(55)
    expect(lens.minAperture).toBe(2.8)
    expect(lens.has).toEqual(['distortion', 'tca', 'vignetting'])
  })

  it('drops models it cannot render but keeps the lens', () => {
    const fish = db.lenses[1]
    expect(fish.type).toBe('fisheye')
    expect(fish.mounts).toEqual(['Canon EF', 'Nikon F'])
    expect(fish.calibrations[0].distortion).toEqual([])
    expect(fish.calibrations[0].tca[0]).toEqual({ model: 'linear', focal: 8, terms: [1.0002, 0.9998] })
    expect(fish.has).toEqual(['tca'])
    expect(fish.model).toBe('8mm f/3.5 Fish-eye & more')
  })
})
